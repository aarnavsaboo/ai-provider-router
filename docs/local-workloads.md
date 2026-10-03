# Local workload experiments

Provider routing is easiest to evaluate with repeatable jobs rather than interactive manual requests.

The workload helper repeats the same ordered batch and records the route result from each request. This makes concurrency changes visible while leaving provider behaviour inside the normal router.

Useful local experiments include:

- one model vs two explicit fallback models;
- concurrency 1/2/4/8;
- warm local server vs first request after load;
- small model primary with larger model fallback;
- different timeout boundaries;
- task families routed to different local runtimes.

Keep raw workload records if the summary changes. Aggregate percentiles are useful, but the per-request provider and attempt count explain why they changed.
