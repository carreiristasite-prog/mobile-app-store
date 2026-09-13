// Compatibility facade: the pure, versioned engine is shared by the API and
// durable worker so deadline finalization cannot drift from request scoring.
export * from "@workspace/simulation-engine";
