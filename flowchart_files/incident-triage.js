function triageIncident(incident) {
  if (incident.severity === "critical") {
    pageOnCall();
  } else {
    createTicket();
  }

  while (!incident.mitigated) {
    attemptRecovery();

    if (incident.customerImpact) {
      postStatusUpdate();
    }

    if (incident.retryCount > 2) {
      escalateIncident();
      return "escalated";
    }
  }

  closeIncident();
  return "resolved";
}
