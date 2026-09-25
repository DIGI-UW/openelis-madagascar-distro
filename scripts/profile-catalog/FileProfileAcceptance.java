package org.itech.ahb.connection;

import ca.uhn.fhir.context.FhirContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Device;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Specimen;
import org.itech.ahb.config.properties.HTTPForwardServerConfigurationProperties;
import org.itech.ahb.file.FileConfig;
import org.itech.ahb.file.FileMessageHandler;
import org.itech.ahb.file.FileWatcher;
import org.itech.ahb.file.SqliteFileStateStore;
import org.itech.ahb.outbox.FhirDeliveryClient;
import org.itech.ahb.outbox.OutboxDispatcher;
import org.itech.ahb.outbox.OutboxProperties;
import org.itech.ahb.outbox.SqliteOutboxStore;
import org.itech.ahb.profile.AnalyzerProfileCatalog;
import org.itech.ahb.routing.NormalizedBundleRenderer;
import org.springframework.core.io.FileSystemResource;

/**
 * Tests one shipped FILE profile through saved activation, real directory watching,
 * disk restart, parsing and HTTP forwarding. This does not prove source-loss recovery,
 * retry/DMQ behavior, OE2 clinical ingestion, or physical instrument correctness.
 * Expectations and fixture bytes belong to the distro; execution belongs to Bridge.
 */
public final class FileProfileAcceptance {

  private static final String EXT = "https://openelis-global.org/fhir/StructureDefinition/";
  private final ObjectMapper json = new ObjectMapper();
  private final List<Bundle> deliveries = new CopyOnWriteArrayList<>();
  private final List<String> receiverErrors = new CopyOnWriteArrayList<>();
  private final Path profilePath;
  private final Path casePath;
  private final Path state;
  private final Path inbox;
  private final ObjectNode profile;
  private HttpServer receiver;
  private FileWatcher watcher;
  private SqliteOutboxStore outboxStore;
  private OutboxDispatcher dispatcher;
  private SqliteFileStateStore fileStore;
  private AnalyzerConnectionCatalog connections;
  private AnalyzerRuntimeRegistry registry;
  private String connectionId;

  private FileProfileAcceptance(Path profilePath, Path casePath) throws Exception {
    this.profilePath = profilePath.toRealPath();
    this.casePath = casePath.toRealPath();
    profile = (ObjectNode) json.readTree(profilePath.toFile());
    state = Files.createTempDirectory("distro-file-acceptance-");
    inbox = Files.createDirectory(state.resolve("inbox"));
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("Usage: FileProfileAcceptance <profile.json> <case.json>");
    new FileProfileAcceptance(Path.of(args[0]), Path.of(args[1])).run();
  }

  private void run() throws Exception {
    receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    receiver.createContext("/", exchange -> {
      try {
        check("/analyzer/fhir".equals(exchange.getRequestURI().getPath()), "wrong forwarding endpoint");
        check(
          exchange.getRequestHeaders().getFirst("Content-Type").startsWith("application/fhir+json"),
          "wrong media type"
        );
        String body = new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        deliveries.add(FhirContext.forR4Cached().newJsonParser().parseResource(Bundle.class, body));
        exchange.sendResponseHeaders(200, -1);
      } catch (Throwable error) {
        receiverErrors.add(error.toString());
        exchange.sendResponseHeaders(500, -1);
      } finally {
        exchange.close();
      }
    });
    receiver.start();
    try {
      JsonNode scenario = json.readTree(casePath.toFile());
      check(scenario.path("phases").size() >= 2, "case must exercise restart with fresh input");
      reopen();
      var create = json
        .createObjectNode()
        .put("schemaVersion", "1.0")
        .put("requestId", UUID.randomUUID().toString())
        .put("clientAnalyzerId", "distro-acceptance")
        .put("displayName", "Distro acceptance");
      create
        .putObject("profileRef")
        .put("profileId", profile.path("profileMeta").path("id").asText())
        .put("revision", profile.path("catalog").path("revision").asInt())
        .put("fingerprint", profile.path("catalog").path("revisionFingerprint").asText());
      create.putObject("values").put("directory", inbox.toString());
      ObjectNode saved = connections.create(create);
      check(saved.path("readiness").path("ready").asBoolean(), "connection not ready with profile defaults");
      connectionId = saved.path("connectionId").asText();
      var activate = json
        .createObjectNode()
        .put("schemaVersion", "1.0")
        .put("commandId", UUID.randomUUID().toString())
        .put("connectionId", connectionId)
        .put("action", "ACTIVATE")
        .put("expectedConfigRevision", 1);
      check(
        "ACTIVE".equals(connections.applyRuntimeCommand(activate).path("actualRuntimeState").asText()),
        "activation failed"
      );
      List<JsonNode> expected = new ArrayList<>();
      int phase = 0;
      for (JsonNode step : scenario.path("phases")) {
        if (phase++ > 0) {
          stopRuntime();
          reopen(); // Saved active connection restores; no manual registry insertion or reactivation.
          check(
            "ACTIVE".equals(connections.require(connectionId).path("actualRuntimeState").asText()),
            "restart lost activation"
          );
          var restored = registry.findAnalyzerEntryByConnectionId(connectionId).orElseThrow();
          check(
            restored.getProfileRevision() == profile.path("catalog").path("revision").asInt(),
            "restart changed pin"
          );
        }
        step.path("expected").forEach(expected::add);
        Path fixture = casePath.getParent().resolve(step.required("file").asText()).normalize();
        Path target = inbox.resolve(step.required("file").asText()).getFileName();
        Files.copy(fixture, inbox.resolve(target));
        int expectedCount = expected.size();
        waitUntil(() -> !receiverErrors.isEmpty() || deliveries.size() >= expectedCount);
        check(receiverErrors.isEmpty(), "receiver failure: " + receiverErrors);
        // Stop drains file workers before exact-count assertions or reopening SQLite.
        watcher.stop();
        assertDeliveries(expected);
        check(
          java.util.Arrays.equals(Files.readAllBytes(fixture), Files.readAllBytes(inbox.resolve(target))),
          "source bytes changed"
        );
      }
      System.out.println(
        "PASS FILE profile " +
        profile.path("profileMeta").path("id").asText() +
        "@" +
        profile.path("catalog").path("revision").asInt() +
        ": " +
        deliveries
          .stream()
          .flatMap(bundle -> bundle.getEntry().stream())
          .filter(entry -> entry.getResource() instanceof Observation)
          .count() +
        " exact observations in " +
        deliveries.size() +
        " deliveries across saved restart; no duplicate earlier deliveries"
      );
    } finally {
      stopRuntime();
      receiver.stop(0);
      try (var paths = Files.walk(state)) {
        for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
      }
    }
  }

  private void assertDeliveries(List<JsonNode> expected) {
    check(
      deliveries.size() == expected.size(),
      "unexpected delivery count " + deliveries.size() + "/" + expected.size()
    );
    var seen = new HashSet<String>();
    for (Bundle bundle : deliveries) {
      var resources = bundle.getEntry().stream().map(Bundle.BundleEntryComponent::getResource).toList();
      var specimens = resources.stream().filter(Specimen.class::isInstance).map(Specimen.class::cast).toList();
      check(specimens.size() == 1, "expected one specimen");
      String accession = specimens.get(0).getIdentifierFirstRep().getValue();
      check(seen.add(accession), "duplicate accession delivery: " + accession);
      JsonNode row = expected
        .stream()
        .filter(e -> accession.equals(e.path("accession").asText()))
        .findFirst()
        .orElseThrow(() -> new AssertionError("unexpected accession " + accession));
      var devices = resources.stream().filter(Device.class::isInstance).map(Device.class::cast).toList();
      check(devices.size() == 1, "expected one analyzer identity");
      var device = devices.get(0);
      check(
        device
          .getIdentifier()
          .stream()
          .anyMatch(
            i ->
              "https://openelis-global.org/fhir/analyzer-connection-id".equals(i.getSystem()) &&
              connectionId.equals(i.getValue())
          ),
        "wrong connection"
      );
      check(
        device
          .getExtensionByUrl(EXT + "analyzer-profile-id")
          .getValue()
          .primitiveValue()
          .equals(profile.path("profileMeta").path("id").asText()),
        "wrong profile"
      );
      check(
        device
          .getExtensionByUrl(EXT + "analyzer-profile-revision")
          .getValue()
          .primitiveValue()
          .equals(profile.path("catalog").path("revision").asText()),
        "wrong revision"
      );
      var observations = resources.stream().filter(Observation.class::isInstance).map(Observation.class::cast).toList();
      List<JsonNode> rows = new ArrayList<>();
      if (row.has("observations")) row.path("observations").forEach(rows::add);
      else rows.add(row);
      check(observations.size() == rows.size(), "wrong observation count for " + accession);
      for (int index = 0; index < rows.size(); index++) {
        JsonNode expectedObservation = rows.get(index);
        var observation = observations.get(index);
        check(
          observation
            .getCode()
            .getCoding()
            .stream()
            .anyMatch(c -> expectedObservation.path("code").asText().equals(c.getCode())),
          "wrong analyzer code"
        );
        String value = observation.hasValueQuantity()
          ? observation.getValueQuantity().getValue().toPlainString()
          : observation.getValue().primitiveValue();
        check(expectedObservation.path("value").asText().equals(value), "wrong value for " + accession + ": " + value);
        if (expectedObservation.has("unit")) check(
          observation.hasValueQuantity() &&
          expectedObservation.path("unit").asText().equals(observation.getValueQuantity().getUnit()),
          "wrong numeric unit"
        );
        check(
          observation
            .getExtensionByUrl(EXT + "analyzer-result-classification")
            .getValue()
            .primitiveValue()
            .equals(expectedObservation.path("classification").asText()),
          "wrong patient/control classification"
        );
        var recognition = observation.getExtensionByUrl(EXT + "analyzer-control-recognition");
        check(
          recognition
            .getExtensionByUrl("recognitionFingerprint")
            .getValue()
            .primitiveValue()
            .equals(profile.path("catalog").path("recognitionFingerprint").asText()),
          "wrong recognition pin"
        );
      }
    }
  }

  private void reopen() throws Exception {
    var profiles = new AnalyzerProfileCatalog(
      state.resolve("profiles"),
      List.of(new FileSystemResource(profilePath)),
      json,
      Clock.systemUTC()
    );
    registry = new AnalyzerRuntimeRegistry();
    fileStore = new SqliteFileStateStore(state.resolve("file-state.db"));
    var http = new HTTPForwardServerConfigurationProperties();
    http.setUri(URI.create("http://127.0.0.1:" + receiver.getAddress().getPort() + "/analyzer"));
    var config = new FileConfig();
    config.setPollIntervalMs(50);
    config.setFileStabilityTimeoutMs(50);
    outboxStore = new SqliteOutboxStore(state.resolve("outbox.db"));
    dispatcher = new OutboxDispatcher(
      outboxStore,
      new FhirDeliveryClient(http),
      new NormalizedBundleRenderer(registry),
      new OutboxProperties()
    );
    watcher = new FileWatcher(config, new FileMessageHandler(registry, outboxStore, dispatcher, json), fileStore);
    watcher.start();
    connections = new AnalyzerConnectionCatalog(
      state.resolve("connections"),
      profiles,
      json,
      Clock.systemUTC(),
      UUID::randomUUID,
      new BridgeAnalyzerConnectionRuntime(registry, watcher, null, null)
    );
    dispatcher.start();
  }

  private void stopRuntime() {
    if (watcher != null) {
      watcher.stop();
      watcher = null;
    }
    if (dispatcher != null) {
      dispatcher.stop();
      dispatcher = null;
    }
    if (fileStore != null) {
      fileStore.close();
      fileStore = null;
    }
    if (outboxStore != null) {
      outboxStore.close();
      outboxStore = null;
    }
  }

  private static void waitUntil(BooleanSupplier complete) throws Exception {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (!complete.getAsBoolean()) {
      if (System.nanoTime() >= deadline) throw new AssertionError("timed out waiting for watched FILE delivery");
      Thread.sleep(25);
    }
  }

  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
