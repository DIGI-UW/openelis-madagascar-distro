package org.itech.ahb.connection;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import org.itech.ahb.config.properties.*;
import org.itech.ahb.mllp.MLLPConfig;
import org.itech.ahb.normalizer.*;
import org.itech.ahb.outbox.*;
import org.itech.ahb.profile.AnalyzerProfileCatalog;
import org.itech.ahb.routing.*;
import org.springframework.core.io.FileSystemResource;

/** Distro-owned fixtures through the shipped profile, saved connection, real ASTM/MLLP and durable HTTP delivery. */
public final class SocketProfileAcceptance {

  private static final String EXT = "https://openelis-global.org/fhir/StructureDefinition/";
  private final ObjectMapper json = new ObjectMapper();
  private final LinkedBlockingQueue<JsonNode> deliveries = new LinkedBlockingQueue<>();
  private final List<String> errors = new CopyOnWriteArrayList<>();
  private final Path profilePath, casePath, state;
  private final ObjectNode profile;
  private HttpServer receiver;
  private SqliteOutboxStore store;
  private OutboxDispatcher dispatcher;
  private ManagedHl7ConnectionListeners listeners;
  private ManagedAstmConnectionListeners astmListeners;
  private AnalyzerConnectionCatalog connections;
  private int sharedPort;

  private SocketProfileAcceptance(Path profilePath, Path casePath) throws Exception {
    this.profilePath = profilePath.toRealPath();
    this.casePath = casePath.toRealPath();
    this.profile = (ObjectNode) json.readTree(profilePath.toFile());
    this.state = Files.createTempDirectory("distro-hl7-acceptance-");
    try (var socket = new ServerSocket(0)) {
      sharedPort = socket.getLocalPort();
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException(
      "Usage: SocketProfileAcceptance <profile.json> <case.json>"
    );
    new SocketProfileAcceptance(Path.of(args[0]), Path.of(args[1])).run();
  }

  private void run() throws Exception {
    receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    receiver.createContext("/analyzer/fhir", exchange -> {
      try {
        check(
          exchange.getRequestHeaders().getFirst("Content-Type").startsWith("application/fhir+json"),
          "wrong media type"
        );
        deliveries.add(json.readTree(exchange.getRequestBody()));
        exchange.sendResponseHeaders(200, -1);
      } catch (Throwable e) {
        errors.add(e.toString());
        exchange.sendResponseHeaders(500, -1);
      } finally {
        exchange.close();
      }
    });
    receiver.start();
    try {
      JsonNode scenario = json.readTree(casePath.toFile());
      check(scenario.path("phases").size() >= 2, "must cover saved restart");
      boot();
      var request = json
        .createObjectNode()
        .put("schemaVersion", "1.0")
        .put("requestId", UUID.randomUUID().toString())
        .put("clientAnalyzerId", "distro-hl7")
        .put("displayName", "Distro HL7 acceptance");
      request
        .putObject("profileRef")
        .put("profileId", profile.path("profileMeta").path("id").asText())
        .put("revision", profile.path("catalog").path("revision").asInt())
        .put("fingerprint", profile.path("catalog").path("revisionFingerprint").asText());
      // No incoming or outgoing per-analyzer port; only the shared listener is configured.
      request
        .putObject("values")
        .put("transport", "TCP/IP")
        .put("host", "127.0.0.1")
        .put("senderId", scenario.required("sender").asText());
      var saved = connections.create(request);
      check(saved.path("readiness").path("ready").asBoolean(), "not ready: " + saved);
      String id = saved.path("connectionId").asText();
      var command = json
        .createObjectNode()
        .put("schemaVersion", "1.0")
        .put("commandId", UUID.randomUUID().toString())
        .put("connectionId", id)
        .put("action", "ACTIVATE")
        .put("expectedConfigRevision", 1);
      check(
        "ACTIVE".equals(connections.applyRuntimeCommand(command).path("actualRuntimeState").asText()),
        "activation failed"
      );
      int phase = 0, results = 0;
      for (JsonNode step : scenario.path("phases")) {
        if (phase++ > 0) {
          stop();
          boot();
          check(
            connections.require(id).path("profileRef").equals(saved.path("profileRef")),
            "restart changed profile pin"
          );
          check(
            "ACTIVE".equals(connections.require(id).path("actualRuntimeState").asText()),
            "restart lost activation"
          );
        }
        String payload = Files.readString(casePath.getParent().resolve(step.required("file").asText())).replace(
          "\n",
          "\r"
        );
        if ("ASTM".equals(profile.path("protocol").path("name").asText())) {
          var records = Arrays.stream(payload.split("\\r"))
            .filter(line -> !line.isBlank())
            .map(line -> line + "\r")
            .toList();
          check(
            new org.itech.ahb.order.OutboundAstmClient().send("127.0.0.1", sharedPort, records, 5000),
            "ASTM handshake failed"
          );
        } else try (var socket = new Socket("127.0.0.1", sharedPort)) {
          socket.setSoTimeout(5000);
          socket.getOutputStream().write(("\u000b" + payload + "\u001c\r").getBytes(StandardCharsets.UTF_8));
          var ack = new StringBuilder();
          int b;
          while ((b = socket.getInputStream().read()) != -1 && b != 0x1c) ack.append((char) b);
          check(ack.toString().contains("MSA|AA|"), "no positive ACK: " + ack);
        }
        var bundle = deliveries.poll(10, TimeUnit.SECONDS);
        check(bundle != null, "no forwarded bundle; errors=" + errors);
        check(errors.isEmpty(), "receiver failed: " + errors);
        results += assertBundle(bundle, step, id);
        dispatcher.dispatchDue();
        check(deliveries.isEmpty(), "unexpected extra delivery");
      }
      System.out.println(
        "PASS " +
        profile.path("protocol").path("name").asText() +
        " " +
        profile.path("profileMeta").path("id").asText() +
        ": " +
        results +
        " exact results across saved restart; no per-analyzer port"
      );
    } finally {
      stop();
      receiver.stop(0);
      try (var paths = Files.walk(state)) {
        for (Path p : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(p);
      }
    }
  }

  private int assertBundle(JsonNode bundle, JsonNode step, String id) {
    var resources = new ArrayList<JsonNode>();
    bundle.path("entry").forEach(e -> resources.add(e.path("resource")));
    var device = resources
      .stream()
      .filter(r -> "Device".equals(r.path("resourceType").asText()))
      .findFirst()
      .orElseThrow();
    check(
      java.util.stream.StreamSupport.stream(device.path("identifier").spliterator(), false).anyMatch(
        i ->
          "https://openelis-global.org/fhir/analyzer-connection-id".equals(i.path("system").asText()) &&
          id.equals(i.path("value").asText())
      ),
      "wrong connection"
    );
    check(
      extension(device, "analyzer-profile-id")
        .path("valueString")
        .asText()
        .equals(profile.path("profileMeta").path("id").asText()),
      "wrong profile"
    );
    check(
      extension(device, "analyzer-profile-revision").path("valueInteger").asInt() ==
      profile.path("catalog").path("revision").asInt(),
      "wrong revision"
    );
    var specimen = resources
      .stream()
      .filter(r -> "Specimen".equals(r.path("resourceType").asText()))
      .findFirst()
      .orElseThrow();
    check(
      specimen.path("identifier").get(0).path("value").asText().equals(step.required("accession").asText()),
      "wrong accession"
    );
    var obs = resources.stream().filter(r -> "Observation".equals(r.path("resourceType").asText())).toList();
    check(obs.size() == step.path("expected").size(), "wrong observation count");
    for (int i = 0; i < obs.size(); i++) {
      JsonNode actual = obs.get(i), expected = step.path("expected").get(i);
      check(
        java.util.stream.StreamSupport.stream(actual.path("code").path("coding").spliterator(), false).anyMatch(
          c ->
            "https://openelis-global.org/fhir/CodeSystem/analyzer-raw-code".equals(c.path("system").asText()) &&
            expected.required("code").asText().equals(c.path("code").asText())
        ),
        "wrong raw code"
      );
      JsonNode value = actual.has("valueQuantity")
        ? actual.path("valueQuantity").path("value")
        : actual.path("valueString");
      check(expected.required("value").asText().equals(value.asText()), "wrong value: " + actual);
      if (expected.has("unit")) check(
        expected.get("unit").asText().equals(actual.path("valueQuantity").path("unit").asText()),
        "wrong unit"
      );
      check(
        expected
          .required("classification")
          .asText()
          .equals(extension(actual, "analyzer-result-classification").path("valueCode").asText()),
        "wrong classification: " + actual
      );
      JsonNode recognition = extension(actual, "analyzer-control-recognition");
      if (expected.has("recognitionOutcome")) {
        check(
          java.util.stream.StreamSupport.stream(recognition.path("extension").spliterator(), false).anyMatch(
            e ->
              "outcome".equals(e.path("url").asText()) &&
              expected.path("recognitionOutcome").asText().equals(e.path("valueCode").asText())
          ),
          "wrong recognition outcome"
        );
        check(
          java.util.stream.StreamSupport.stream(recognition.path("extension").spliterator(), false).noneMatch(
            e -> "evaluation".equals(e.path("url").asText())
          ),
          "invented rule evidence"
        );
      }
      check(
        java.util.stream.StreamSupport.stream(recognition.path("extension").spliterator(), false).anyMatch(
          e ->
            "recognitionFingerprint".equals(e.path("url").asText()) &&
            profile.path("catalog").path("recognitionFingerprint").asText().equals(e.path("valueString").asText())
        ),
        "wrong recognition pin"
      );
    }
    return obs.size();
  }

  private JsonNode extension(JsonNode resource, String suffix) {
    return java.util.stream.StreamSupport.stream(resource.path("extension").spliterator(), false)
      .filter(e -> (EXT + suffix).equals(e.path("url").asText()))
      .findFirst()
      .orElseThrow();
  }

  private void boot() {
    var profiles = new AnalyzerProfileCatalog(
      state.resolve("profiles"),
      List.of(new FileSystemResource(profilePath)),
      json,
      Clock.systemUTC()
    );
    var registry = new AnalyzerRuntimeRegistry();
    var http = new HTTPForwardServerConfigurationProperties();
    http.setUri(URI.create("http://127.0.0.1:" + receiver.getAddress().getPort() + "/analyzer"));
    store = new SqliteOutboxStore(state.resolve("outbox.db"));
    var client = new FhirDeliveryClient(http);
    var renderer = new NormalizedBundleRenderer(registry);
    dispatcher = new OutboxDispatcher(store, client, renderer, new OutboxProperties());
    var router = new HttpForwardingRouter(store, dispatcher, client, renderer);
    var normalizer = new MessageNormalizer(router, new AnalyzerIdentifier(registry), store, registry, null);
    var config = new MLLPConfig();
    config.setEnabled(true);
    config.setPort(sharedPort);
    var inbound = new ASTMLIS1AListenServerConfigurationProperties();
    inbound.setPort(sharedPort);
    if ("ASTM".equals(profile.path("protocol").path("name").asText())) astmListeners =
      new ManagedAstmConnectionListeners(
        normalizer,
        new org.itech.ahb.lib.astm.interpretation.DefaultASTMInterpreterFactory()
      );
    else listeners = new ManagedHl7ConnectionListeners(config, normalizer);
    connections = new AnalyzerConnectionCatalog(
      state.resolve("connections"),
      profiles,
      json,
      Clock.systemUTC(),
      UUID::randomUUID,
      new BridgeAnalyzerConnectionRuntime(
        registry,
        null,
        astmListeners,
        null,
        listeners,
        new AnalyzerListenerPorts(inbound, new ASTME138195ListenServerConfigurationProperties(), config)
      )
    );
    dispatcher.start();
  }

  private void stop() {
    if (astmListeners != null) {
      astmListeners.stopAll();
      astmListeners = null;
    }
    if (listeners != null) {
      listeners.stopAll();
      listeners = null;
    }
    if (dispatcher != null) {
      dispatcher.stop();
      dispatcher = null;
    }
    if (store != null) {
      store.close();
      store = null;
    }
  }

  private static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
}
