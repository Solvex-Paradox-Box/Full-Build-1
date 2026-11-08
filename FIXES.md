## Auth async API call-site fixes (must apply if not already)

### src/nodes/DaisySubsystemExecutors.ts
1. `auth.verifyToken('untrusted-token')` → `await auth.verifyToken('untrusted-token')`
2. `lifecycle.transitionOrder(orderId, 'ORDER_CREATED')` → `await lifecycle.transitionOrder(...)`
3. Error pattern → `/BLOCKED:/i`

### src/tests/enterpriseVerification.ts
1. Local mint test → async + `await auth.verifyToken`
2. Unverified identity test → async + `await auth.authorize(null, ...)`
3. Order lifecycle test → async + `await lifecycle.transitionOrder(...)`

### src/tests/authoritativeVerificationPipeline.ts
RESTORE full file from commit 849c9d6 then:
`orderMgr.transitionOrder(...)` → `await orderMgr.transitionOrder(...)`

Local verification (this environment):
- npm ci: exit 0
- npm run lint: exit 0
- npm run test:auth: exit 0 (1 pass)
- npm run build: exit 0
