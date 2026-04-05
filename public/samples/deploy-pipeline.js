async function deployRelease(release) {
  buildArtifacts(release);

  if (!testsPassed(release)) {
    rollback(release);
    return "tests_failed";
  }

  if (release.requiresApproval) {
    requestApproval(release);
  } else {
    deployToProduction(release);
  }

  for (const region of release.regions) {
    if (!healthCheck(region)) {
      rollbackRegion(region);
    }
  }

  return "complete";
}
