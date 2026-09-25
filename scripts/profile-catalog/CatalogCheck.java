package org.itech.ahb.profile;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/** Release check using the exact Bridge loader, schema and fingerprint implementation. */
public final class CatalogCheck {

  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      throw new IllegalArgumentException("Usage: CatalogCheck <catalog-directory> <manifest.json>");
    }
    Path directory = Path.of(args[0]).toRealPath();
    ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    JsonNode manifest = mapper.readTree(Path.of(args[1]).toFile());
    var validator = new AnalyzerProfileValidator(mapper);
    List<String> failures = new ArrayList<>();
    List<Path> files;
    try (var paths = Files.walk(directory)) {
      files = paths.filter(Files::isRegularFile).filter(path -> path.toString().endsWith(".json")).sorted().toList();
    }
    if (files.isEmpty()) failures.add("Catalog contains no JSON profiles: " + directory);
    for (Path file : files) {
      for (String issue : validator.validationIssues(mapper.readTree(file.toFile()))) {
        failures.add(directory.relativize(file) + ": " + issue);
      }
    }
    failIfNeeded(failures);

    Path state = Files.createTempDirectory("distro-catalog-check-");
    try {
      var properties = new ProfileCatalogProperties();
      properties.setDirectory(state.toString());
      properties.setShippedPattern(directory.toUri() + "**/*.json");
      var catalog = new ProfileCatalogConfiguration()
        .analyzerProfileCatalog(properties, new PathMatchingResourcePatternResolver(), mapper, Clock.systemUTC());
      var actual = new TreeSet<String>();
      for (var revision : catalog.latest()) {
        actual.add(revision.profile().path("profileMeta").path("id").asText());
      }
      var expected = new TreeSet<String>();
      for (JsonNode id : manifest.required("requiredProfileIds")) expected.add(id.asText());
      if (expected.isEmpty()) failures.add("Manifest must require at least one profile");
      if (!actual.equals(expected)) {
        var missing = new TreeSet<>(expected);
        missing.removeAll(actual);
        var unexpected = new TreeSet<>(actual);
        unexpected.removeAll(expected);
        failures.add("Catalog inventory mismatch; missing=" + missing + "; unexpected=" + unexpected);
      }
      for (JsonNode retained : manifest.required("retainedRevisions")) {
        String id = retained.required("profileId").asText();
        int revision = retained.required("revision").asInt();
        try {
          String fingerprint = catalog
            .require(id, revision)
            .profile()
            .path("catalog")
            .path("revisionFingerprint")
            .asText();
          if (!fingerprint.equals(retained.required("revisionFingerprint").asText())) {
            failures.add("Published revision changed: " + id + "@" + revision);
          }
        } catch (ProfileCatalogException exception) {
          failures.add("Published revision missing: " + id + "@" + revision);
        }
      }
      failIfNeeded(failures);
      System.out.println(
        "PASS: " +
        actual.size() +
        " profile families, " +
        files.size() +
        " revisions; all required history retained. Catalog " +
        catalog.catalogFingerprint()
      );
    } finally {
      try (var paths = Files.walk(state)) {
        for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
      }
    }
  }

  private static void failIfNeeded(List<String> failures) {
    if (!failures.isEmpty()) {
      failures.forEach(System.err::println);
      throw new IllegalStateException("Catalog release check failed: " + failures.size() + " issue(s)");
    }
  }
}
