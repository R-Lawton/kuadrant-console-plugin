# RBAC Design Comparison: PR #344 vs PR #346 vs RHDH/Backstage

## Executive Summary

This document compares **three RBAC approaches** for the Kuadrant ecosystem:
1. **PR #344**: Console plugin using namespace-based K8s RBAC
2. **PR #346**: Console plugin using ownership annotations + webhook
3. **RHDH/Backstage (current)**: Backstage plugin using `backstage.io/owner` annotations

| Aspect | PR #344 (Namespace-Based) | PR #346 (Owner-Based) | RHDH/Backstage (Current) |
|--------|---------------------------|------------------------|--------------------------|
| **Core Mechanism** | K8s native RBAC + namespaces | Custom ownership annotations + webhook | Backstage RBAC + ownership annotations |
| **Console Backend** | None (direct K8s API) | New HTTP API server (port 8080) | Backstage backend plugin |
| **Admission Control** | None needed | ValidatingWebhook (port 9443, TLS cert) | None (backend enforces) |
| **Consumer Isolation** | Namespace boundaries | Username filtering | Backend filtering by `backstage.io/owner` |
| **APIKey Location** | Consumer's namespace | Consumer's namespace | Same namespace as APIProduct |
| **Approval Mechanism** | APIKeyApproval CRD (new) | APIKeyApproval CRD (new) | Direct status update (phase) |
| **Ownership Annotation** | None | `kuadrant.io/created-by` | `backstage.io/owner` |
| **Complexity** | Lower (uses K8s primitives) | Higher (custom components) | Moderate (backend plugin) |
| **kubectl Protection** | Native RBAC | Webhook validation | Backend only (kubectl bypass possible) |

---

## Visual Architecture Comparison

### PR #344: Namespace-Based RBAC
```
User (alice) → OpenShift Console
                    ↓ (OAuth token)
             Console Plugin (UI)
                    ↓ (K8s API via consoleFetch)
             Kubernetes API Server
                    ↓ (RBAC enforces: alice has RoleBinding in consumer-team-mobile)
             ✅ CREATE APIKey in consumer-team-mobile (ALLOWED)
             ❌ CREATE APIKey in other-team (DENIED by RBAC)
                    ↓
             developer-portal-controller
                    ↓
             CREATE Secret in consumer-team-mobile

Enforcement: K8s RBAC (namespace boundaries)
Ownership: Implicit (namespace membership)
kubectl: Fully protected (RBAC blocks)
```

### PR #346: Ownership-Based RBAC
```
User (alice) → OpenShift Console
                    ↓ (OAuth token)
             Console Plugin (UI)
                    ↓ (HTTP API)
             HTTP API Server (port 8080)
                    ↓ (TokenReview → validates alice)
             CREATE APIKey
                    ↓ (K8s API)
             Kubernetes API Server
                    ↓ (calls webhook)
             ValidatingWebhook (port 9443)
                    ↓ (sets kuadrant.io/created-by: alice)
             ✅ ALLOW (sets ownership)
                    ↓
             developer-portal-controller
                    ↓ (reconciler mirrors annotation → status.owner)
             UPDATE status.owner: alice
                    ↓
             CREATE Secret in consumer-team-mobile

Enforcement: Webhook (admission) + HTTP API (filtering)
Ownership: Explicit (kuadrant.io/created-by annotation)
kubectl: Protected by webhook (blocks writes, not reads)
```

### RHDH/Backstage: Backend-Enforced RBAC
```
User (alice) → Backstage UI
                    ↓ (Backstage auth)
             Backstage Frontend
                    ↓ (HTTP API)
             Backstage Backend Plugin
                    ↓ (permission check: kuadrant.apikey.create)
             ✅ ALLOW (alice has permission)
                    ↓ (K8s client-node)
             CREATE APIKey in payment-services (owner's namespace!)
                    ↓ (sets backstage.io/owner: user:default/alice)
             Kubernetes API Server
                    ↓ (no webhook, direct storage)
             APIKey created
                    ↓
             developer-portal-controller
                    ↓ (watches status.phase)
             CREATE Secret in payment-services (same namespace)

Enforcement: Backend plugin (Backstage RBAC)
Ownership: Explicit (backstage.io/owner annotation)
kubectl: NOT protected (user can bypass backend)
```

### Key Differences Summary

| Aspect | PR #344 | PR #346 | RHDH |
|--------|---------|---------|------|
| **Enforcement Point** | K8s API Server | Webhook + HTTP API | Backend Plugin |
| **Ownership Storage** | None (implicit) | Annotation + Status | Annotation |
| **kubectl Protection** | ✅ RBAC | ✅ Webhook (writes) | ❌ None |
| **APIKey Namespace** | Consumer's | Consumer's | **Owner's** |
| **Secret Namespace** | Consumer's | Consumer's | **Owner's** |
| **Components** | 0 new | 2 new (webhook + API) | 1 new (backend) |
| **Complexity** | Low | High | Medium |

---

## 0. RHDH/Backstage Current Implementation

### Architecture

```
┌─────────────────────────────────────┐
│  Backstage Frontend                 │
│  - Uses Backstage RBAC hooks        │
│  - Permission checks in UI          │
└──────────────┬──────────────────────┘
               │ HTTP API
               ▼
┌─────────────────────────────────────┐
│  Backstage Backend Plugin           │
│  - Tiered permission checks         │
│  - Ownership filtering              │
│  - Sets backstage.io/owner          │
└──────────────┬──────────────────────┘
               │ K8s client-node
               ▼
┌─────────────────────────────────────┐
│  Kubernetes API Server              │
│  - Stores APIProduct/APIKey CRDs    │
│  - NO admission control             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  developer-portal-controller        │
│  - Watches APIKey (status.phase)    │
│  - Creates Secrets                  │
│  - Approval via phase change        │
└─────────────────────────────────────┘
```

### Ownership Model

**APIProduct ownership:**
```yaml
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIProduct
metadata:
  name: payment-api-v1
  namespace: payment-services
  annotations:
    backstage.io/owner: "user:default/bob"  # ← Set by Backstage backend
spec:
  displayName: "Payment API v1"
  approvalMode: manual
```

**How it works:**
- User creates APIProduct via Backstage UI
- Backend sets `backstage.io/owner` annotation (format: `user:default/username`)
- Ownership is **immutable** - backend blocks changes via input validation
- List endpoint filters: if user has `.own` permission, backend filters by owner

### Permission Model

**Four personas** (from `docs/rbac-permissions.md`):

1. **API Consumer**:
   - `kuadrant.apiproduct.read.all` - browse catalog
   - `kuadrant.apikey.create` - request access
   - `kuadrant.apikey.read.own` - view own requests
   - `kuadrant.apikey.update.own` - edit own pending requests
   - `kuadrant.apikey.delete.own` - cancel own requests

2. **API Owner**:
   - All Consumer permissions, plus:
   - `kuadrant.apiproduct.create` - create APIProducts
   - `kuadrant.apiproduct.update.own` - update own APIProducts
   - `kuadrant.apiproduct.delete.own` - delete own APIProducts
   - `kuadrant.apikey.approve` - access approval queue for own APIs
   - `kuadrant.apikey.delete.own` - delete APIKeys for own APIs

3. **API Admin**:
   - All `.all` scoped permissions
   - `kuadrant.apiproduct.read.all` - view all APIProducts
   - `kuadrant.apiproduct.update.all` - update any APIProduct
   - `kuadrant.apiproduct.delete.all` - delete any APIProduct
   - `kuadrant.apikey.read.all` - view all requests
   - `kuadrant.apikey.update.all` - update any request
   - `kuadrant.apikey.approve` - approve any request

4. **Platform Engineer**:
   - Full cluster admin access
   - Manage infrastructure (Gateways, HTTPRoutes, PlanPolicies)
   - Typically does not manage day-to-day API Products

### Approval Workflow

**Current implementation (using status.phase):**

1. Consumer creates APIKey via Backstage
2. Backend sets `spec.requestedBy.userId` and `spec.requestedBy.email`
3. APIKey starts with `status.phase: Pending`
4. Owner views approval queue (filtered by ownership of referenced APIProduct)
5. Owner calls backend endpoint: `PATCH /apikeys/:namespace/:name`
6. Backend validates ownership and updates `status.phase: Approved`
7. Controller watches phase change → creates Secret

**Key characteristics:**
- ✅ Approval is a direct status update (no separate CRD)
- ✅ Backend enforces ownership (tiered permission checks)
- ⚠️ kubectl can bypass approval (user can `kubectl patch apikey --subresource=status`)
- ⚠️ No webhook to protect kubectl access

### APIKey Namespace Placement

**Current behavior:**
- APIKey created in **same namespace as APIProduct**
- Example: APIProduct in `payment-services` → APIKey also in `payment-services`
- Secret created in **same namespace** as APIKey

**Implications:**
- ⚠️ All consumers create APIKeys in owner's namespace
- ⚠️ Consumers need write permissions in owner's namespace
- ⚠️ No consumer isolation via namespaces

### Backend Enforcement Pattern

**Tiered permission checks** (from `docs/rbac-permissions.md`):

```typescript
// Example: Update APIProduct
async function updateAPIProduct(namespace: string, name: string, patch: any) {
  // 1. Try .all permission (admin access)
  const allDecision = await permissions.authorize(
    [{ permission: kuadrantApiProductUpdateAllPermission }],
    { credentials }
  );

  if (allDecision[0].result !== AuthorizeResult.ALLOW) {
    // 2. Fallback to .own permission
    const ownDecision = await permissions.authorize(
      [{ permission: kuadrantApiProductUpdateOwnPermission }],
      { credentials }
    );

    if (ownDecision[0].result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('Unauthorized');
    }

    // 3. Verify ownership
    const apiProduct = await k8sClient.get(namespace, name);
    const owner = apiProduct.metadata?.annotations?.['backstage.io/owner'];
    const ownerUserId = extractUserIdFromOwner(owner); // "user:default/bob" → "bob"

    if (ownerUserId !== currentUserId) {
      throw new NotAllowedError('You can only update your own API Products');
    }
  }

  // Prevent ownership hijacking
  if (patch.metadata?.annotations) {
    delete patch.metadata.annotations['backstage.io/owner'];
  }

  // Proceed with update
  await k8sClient.patch(namespace, name, patch);
}
```

### Security Layers

**Two layers:**

| Layer | Mechanism | Protects Against |
|-------|-----------|------------------|
| **Layer 1: Backstage Backend** | Tiered permission checks + ownership validation | Unauthorized UI/API access |
| **Layer 2: Controller** | Watches phase changes, creates Secrets | Enforces approval workflow |

**No layer 3 (kubectl):**
- ⚠️ kubectl can bypass backend (direct K8s API access)
- ⚠️ Users can modify `status.phase` directly
- ⚠️ Users can change `backstage.io/owner` annotation
- ✅ Acceptable because RHDH users are trusted (Backstage environment)

### Strengths

1. ✅ **Well-documented permissions model** - Clear `.own` / `.all` pattern
2. ✅ **Four-persona hierarchy** - Platform Engineer → API Admin → API Owner → API Consumer
3. ✅ **Immutable ownership** - Backend blocks annotation changes
4. ✅ **Approval queue filtering** - Owners only see requests for their APIs
5. ✅ **Resource-level permissions** - Can restrict APIKey creation per-APIProduct
6. ✅ **Backend enforces everything** - Consistent security model

### Weaknesses

1. ⚠️ **No kubectl protection** - Users can bypass backend via direct K8s API
2. ⚠️ **No namespace isolation** - All APIKeys in owner's namespace
3. ⚠️ **No admission control** - No webhook to enforce ownership
4. ⚠️ **Approval via status update** - No separate APIKeyApproval CRD
5. ⚠️ **Consumers need write access** - To owner's namespace (potential privilege escalation)
6. ⚠️ **Backend is single point of failure** - All enforcement in one place

### Integration with Console Plugin

**Key question**: Should the console plugin replicate the RHDH model or diverge?

**Option A: Replicate RHDH** (PR #346 is closer):
- Use `backstage.io/owner` annotation (same as RHDH)
- Add webhook to protect kubectl access (improvement over RHDH)
- Keep approval workflow similar (but add APIKeyApproval CRD)
- **Benefit**: Consistency across UI tools (Backstage + Console)

**Option B: Diverge from RHDH** (PR #344 approach):
- Use K8s native RBAC (different from RHDH)
- No ownership annotations needed
- Namespace-based isolation (stronger than RHDH)
- **Benefit**: Simpler, more secure, K8s-native

---

## 1. Resource Ownership Model

### PR #344: Namespace = Ownership
```yaml
# Consumer creates APIKey in their namespace
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKey
metadata:
  name: mobile-app-payment-key
  namespace: consumer-team-mobile  # Consumer's namespace = ownership
spec:
  apiProductRef:
    name: payment-api-v1
    namespace: payment-services  # Cross-namespace ref
```

**Enforcement**: Kubernetes RBAC via RoleBinding to namespace

### PR #346: Annotation + Status = Ownership
```yaml
# Consumer creates APIKey in their namespace
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKey
metadata:
  name: mobile-app-payment-key
  namespace: consumer-team-mobile
  annotations:
    kuadrant.io/created-by: alice  # ← Set by webhook
spec:
  apiProductRef:
    name: payment-api-v1
    namespace: payment-services
  requester: alice  # ← Also set by webhook
status:
  owner: alice  # ← Mirrored by controller
```

**Enforcement**: Webhook checks `status.owner == user` OR `user in kuadrant-api-admins`

---

## 2. Component Architecture

### PR #344: Minimal Components
```
┌─────────────────────────────────────┐
│  Console Plugin                     │
│  - Uses consoleFetch                │
│  - Calls K8s API directly           │
│  - No custom backend                │
└──────────────┬──────────────────────┘
               │ K8s API (RBAC enforced)
               ▼
┌─────────────────────────────────────┐
│  Kubernetes API Server              │
│  - Native RBAC enforcement          │
│  - No webhook needed                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  developer-portal-controller        │
│  - Watches APIKey                   │
│  - Watches APIKeyApproval           │
│  - Creates Secrets                  │
│  - Updates status                   │
└─────────────────────────────────────┘
```

### PR #346: Custom Components
```
┌─────────────────────────────────────┐
│  Console Plugin                     │
│  - Calls HTTP API                   │
│  - Server-side filtering            │
└──────────────┬──────────────────────┘
               │ HTTP API (port 8080)
               ▼
┌─────────────────────────────────────┐
│  developer-portal-controller        │
│  ┌───────────────────────────────┐  │
│  │ HTTP API Server (NEW)         │  │
│  │ - GET /apiproducts            │  │
│  │ - GET /apikeys/my-keys        │  │
│  │ - GET /apikeys/approval-queue │  │
│  │ - POST .../approve            │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ValidatingWebhook (NEW)       │  │
│  │ - Port 9443 (TLS cert needed) │  │
│  │ - Sets created-by annotation  │  │
│  │ - Validates ownership         │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Reconciler (MODIFY)           │  │
│  │ - Mirrors annotation→status   │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ K8s API
               ▼
┌─────────────────────────────────────┐
│  Kubernetes API Server              │
│  - Calls webhook for validation     │
└─────────────────────────────────────┘
```

---

## 3. Consumer Isolation

### PR #344: Namespace Boundaries
**Mechanism**: Each consumer team gets RoleBinding to their namespace

```bash
# Mobile team has RoleBinding in consumer-team-mobile
kubectl create rolebinding api-consumer-binding \
  --clusterrole=api-consumer \
  --group=mobile-app-developers \
  -n consumer-team-mobile
```

**Security**:
- ✅ Kubernetes enforces isolation (mobile team cannot list APIKeys in `consumer-team-backend`)
- ✅ No custom filtering needed
- ✅ Works with kubectl automatically
- ⚠️ Requires namespace per team (Pattern 2) for strict isolation
- ⚠️ Shared namespace (Pattern 1) = no RBAC isolation

**Isolation strength**: **Native K8s RBAC** (very strong)

### PR #346: Server-Side Filtering
**Mechanism**: HTTP API filters by `spec.requester == currentUser`

```go
func (api *APIServer) GetMyAPIKeys(req *http.Request) {
    currentUser := extractUserFromToken(req.Header.Get("Authorization"))

    allKeys := k8sClient.List(APIKeys{})

    // Server-side filter
    myKeys := filter(allKeys, func(key APIKey) bool {
        return key.Spec.Requester == currentUser.Username
    })

    return myKeys
}
```

**Security**:
- ✅ Server-side filtering prevents data leakage in console UI
- ✅ Works regardless of namespace organization
- ⚠️ kubectl bypass: User can still `kubectl get apikeys -A` and see all metadata
- ⚠️ Webhook blocks modifications, but not reads
- ⚠️ Adds complexity (custom API server)

**Isolation strength**: **UI-level filtering + webhook write protection** (moderate)

---

## 4. Approval Workflow

### Both PRs: APIKeyApproval CRD (Agreement!)

Both designs introduce the same **APIKeyApproval** resource:

```yaml
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKeyApproval
metadata:
  name: mobile-app-payment-key-approval
  namespace: payment-services  # Owner's namespace
spec:
  apiKeyRef:
    name: mobile-app-payment-key
    namespace: consumer-team-mobile  # Cross-namespace ref
  approved: true
  reviewedBy: "bob@payment-team.com"
  message: "Approved for mobile integration"
```

**Both PRs agree**:
- ✅ Owners create APIKeyApproval in their own namespace
- ✅ Cross-namespace reference to consumer's APIKey
- ✅ Controller reconciles → updates APIKey status
- ✅ No validation webhook needed for approval (RBAC separation)

**Difference**:
- **PR #344**: No additional validation (namespace RBAC is enough)
- **PR #346**: Webhook validates ownership when updating APIProduct/APIKey

---

## 5. Security Model

### PR #344: Three Layers (K8s Native)

| Layer | Mechanism | Protects Against |
|-------|-----------|------------------|
| **Layer 1: K8s RBAC** | RoleBinding to namespace | Unauthorized create/update/delete via kubectl/UI |
| **Layer 2: Console UI** | `useAccessReviews` checks | Confusing UX (hides disabled actions) |
| **Layer 3: Controller** | Watches APIKeyApproval | Enforces approval workflow |

**Threat protection**:
- ✅ kubectl bypass: Blocked by K8s RBAC
- ✅ Cross-namespace access: Blocked by namespace boundaries
- ✅ Approval bypass: Consumers cannot create APIKeyApproval (no RBAC)
- ✅ No custom code needed

### PR #346: Three Layers (Custom)

| Layer | Mechanism | Protects Against |
|-------|-----------|------------------|
| **Layer 1: Webhook** | Admission control | Unauthorized create/update/delete via kubectl |
| **Layer 2: HTTP API** | Server-side filtering | Data leakage in reads |
| **Layer 3: Console UI** | Client-side filtering | Confusing UX |

**Threat protection**:
- ✅ kubectl bypass (writes): Blocked by webhook
- ⚠️ kubectl bypass (reads): User can `kubectl get apikeys -A` and see metadata
- ✅ Ownership transfer: Blocked by webhook (only admins)
- ✅ Approval bypass: Webhook validates ownership before approval

**Additional complexity**:
- ⚠️ Webhook requires TLS certificate management
- ⚠️ HTTP API server requires authentication (TokenReview)
- ⚠️ More moving parts = more failure modes

---

## 6. Deployment Complexity

### PR #344: Simple Deployment
```bash
# 1. Apply ClusterRoles (once)
kubectl apply -f config/rbac/api-consumer-role.yaml
kubectl apply -f config/rbac/api-owner-role.yaml

# 2. Create namespace
kubectl create namespace consumer-team-mobile

# 3. Bind users/groups
kubectl create rolebinding api-consumer-binding \
  --clusterrole=api-consumer \
  --group=mobile-team \
  -n consumer-team-mobile

# DONE - No additional infrastructure needed
```

**Operational requirements**:
- ✅ Standard K8s RBAC
- ✅ No certificates to manage
- ✅ No additional services/ports
- ✅ Works with existing OpenShift OAuth

### PR #346: Complex Deployment
```bash
# 1. Apply ClusterRoles
kubectl apply -f config/rbac/api-owner-role.yaml
kubectl apply -f config/rbac/api-admin-clusterrole.yaml

# 2. Generate TLS certificate for webhook
cert-manager create certificate kuadrant-webhook \
  --dns-name=developer-portal-controller.kuadrant-system.svc

# 3. Deploy HTTP API server (port 8080)
# Update developer-portal-controller deployment manifest

# 4. Deploy webhook (port 9443)
# Update developer-portal-controller deployment manifest

# 5. Register webhook
kubectl apply -f webhook-configuration.yaml

# 6. Create admin group
kubectl create group kuadrant-api-admins
kubectl patch user alice --group kuadrant-api-admins

# DONE - But requires certificate rotation, monitoring additional ports
```

**Operational requirements**:
- ⚠️ TLS certificate management (cert-manager or manual)
- ⚠️ HTTP API server (port 8080)
- ⚠️ Webhook server (port 9443)
- ⚠️ ValidatingWebhookConfiguration
- ⚠️ Custom admin group management

---

## 7. GitOps and kubectl Compatibility

### PR #344: Fully kubectl Compatible
```bash
# Users can do everything via kubectl (GitOps friendly)
kubectl create -f apiproduct.yaml --as=owner
kubectl create -f apikey.yaml --as=consumer
kubectl create -f apikeyapproval.yaml --as=owner

# RBAC enforces permissions - no special tooling needed
```

**Benefits**:
- ✅ GitOps friendly (ArgoCD, Flux work natively)
- ✅ No UI required for operations
- ✅ Declarative YAML workflows
- ✅ Consistent with K8s patterns

### PR #346: kubectl Works But Limited
```bash
# kubectl works for writes (webhook validates)
kubectl create -f apiproduct.yaml --as=owner  # ✅ Webhook sets ownership
kubectl create -f apikey.yaml --as=consumer   # ✅ Webhook sets requester

# BUT reads show all resources (no RBAC isolation for reads)
kubectl get apikeys -A  # ⚠️ Shows all APIKeys (not filtered by owner)

# Console UI provides filtering, but kubectl users see everything
```

**Limitations**:
- ⚠️ kubectl reads not filtered (sees all resources)
- ⚠️ Users must use console UI for filtered views
- ⚠️ GitOps sees all resources (may need custom tooling)

---

## 8. Admin Experience

### PR #344: Admin = Cluster-Admin Subset
```yaml
# Admin gets full access via ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: api-admin
rules:
  - apiGroups: ["devportal.kuadrant.io"]
    resources: ["apiproducts", "apikeys", "apikeyapprovals"]
    verbs: ["*"]  # All operations, all namespaces
```

**Admin capabilities**:
- ✅ Manage resources in any namespace
- ✅ No special admin group needed
- ✅ Can be granted via standard ClusterRoleBinding
- ✅ Works like other K8s admin roles

### PR #346: Custom Admin Group
```yaml
# Webhook checks for special group membership
func isGlobalAdmin(groups []string) bool {
    return contains(groups, "kuadrant-api-admins")
}

# Admins can transfer ownership
kubectl annotate apiproduct petstore-api \
  kuadrant.io/created-by=newowner \
  --as=admin
```

**Admin capabilities**:
- ✅ Transfer ownership between users/teams
- ✅ Bypass all ownership restrictions
- ⚠️ Requires creating `kuadrant-api-admins` group
- ⚠️ Non-standard K8s pattern (custom group in webhook)

---

## 9. CRD Changes Required

### PR #344: New CRD Only
**Changes**:
- ✅ Add APIKeyApproval CRD (new)
- ✅ Add `spec.apiProductRef.namespace` to APIKey
- ✅ Change `status.phase` → `status.conditions` (CSR pattern)
- ❌ No ownership fields needed

**Backward compatibility**: Additive changes only

### PR #346: New CRD + Ownership Fields
**Changes**:
- ✅ Add APIKeyApproval CRD (new)
- ✅ Add `spec.apiProductRef.namespace` to APIKey
- ✅ Change `status.phase` → `status.conditions`
- ⚠️ Add `kuadrant.io/created-by` annotation (APIProduct + APIKey)
- ⚠️ Add `status.owner` field (APIProduct + APIKey)
- ⚠️ Add `spec.requester` field (APIKey)

**Backward compatibility**: Requires backfilling existing resources

---

## 10. RHDH/Backstage Compatibility

### Both PRs: Compatible
Both designs maintain compatibility with the existing RHDH/Backstage deployment:

**PR #344**:
- RHDH service account gets ClusterRoleBinding to `api-admin` ClusterRole
- No changes to RHDH workflows

**PR #346**:
- RHDH service account added to `kuadrant-api-admins` group
- OR granted ClusterRole that bypasses webhook
- No changes to RHDH workflows

**Verdict**: Both are equally compatible ✅

---

## 11. Trade-offs Summary

| Aspect | PR #344 Wins | PR #346 Wins |
|--------|--------------|--------------|
| **Simplicity** | ✅ Fewer components | |
| **K8s Native** | ✅ Uses standard RBAC | |
| **GitOps Friendly** | ✅ kubectl-first | |
| **kubectl Read Isolation** | ✅ Namespace boundaries | |
| **Operational Overhead** | ✅ No certs/webhooks | |
| **Ownership Visibility** | | ✅ Explicit `status.owner` |
| **Ownership Transfer** | ❌ Not supported | ✅ Admin can transfer |
| **UI Filtering** | ⚠️ Client-side | ✅ Server-side API |
| **Shared Namespace Support** | ⚠️ No isolation | ✅ Works with any org |

---

## 12. Hybrid Approach Options

### Option A: PR #344 + Ownership Tracking (Informational)
**Add to PR #344**:
- Add `status.owner` field (informational only, not enforced)
- Controller sets it from namespace + username
- UI can display "Owned by: alice" for clarity
- **NO webhook** - RBAC is still the enforcement mechanism

**Benefits**:
- ✅ K8s native RBAC enforcement
- ✅ Ownership visibility in UI
- ✅ No webhook complexity

**Trade-offs**:
- ⚠️ Ownership field is cosmetic (not enforced)

### Option B: PR #346 Webhook + PR #344 Namespace RBAC
**Combine both**:
- Use namespace RBAC for base permissions
- Add webhook for additional validation (ownership transfer restrictions)
- Use K8s API directly (no custom HTTP server)

**Benefits**:
- ✅ Strong namespace isolation
- ✅ Ownership tracking
- ✅ Admin transfer capabilities

**Trade-offs**:
- ⚠️ Still requires webhook (TLS certs)
- ⚠️ More complex than pure PR #344

### Option C: PR #344 + Shared Namespace Pattern Only
**Simplify PR #344**:
- Remove Pattern 2 (namespace-per-team)
- Use only Pattern 1 (shared namespace)
- Add client-side UI filtering by `spec.requester`
- Accept that consumers can see each other's metadata

**Benefits**:
- ✅ Simplest possible deployment
- ✅ Good for trusted environments

**Trade-offs**:
- ⚠️ No RBAC isolation between consumers
- ⚠️ Requires trust between consumers

---

## 13. Recommendation

### For Most Teams: **PR #344 (Namespace-Based RBAC)**

**Why**:
1. ✅ **Simpler**: No webhook, no TLS certs, no custom HTTP API
2. ✅ **K8s Native**: Uses standard RBAC patterns familiar to platform teams
3. ✅ **GitOps Friendly**: Works with kubectl, ArgoCD, Flux out of the box
4. ✅ **Stronger Isolation**: Namespace boundaries prevent kubectl bypass
5. ✅ **Lower Operational Overhead**: Fewer moving parts to maintain

**Best for**:
- Teams familiar with K8s RBAC
- GitOps workflows
- Strict consumer isolation requirements
- Organizations that can map teams → namespaces

**Caveat**: Requires namespace organization (Pattern 2 for isolation, or Pattern 1 if consumers are trusted)

---

### When to Choose PR #346 (Owner-Based RBAC)

**Why**:
1. ✅ **Ownership Transfer**: Admins can transfer APIProducts between users/teams
2. ✅ **Flexible Namespace Organization**: Works with any namespace structure
3. ✅ **Server-Side Filtering**: UI gets pre-filtered data from HTTP API
4. ✅ **Explicit Ownership Tracking**: Clear `status.owner` field

**Best for**:
- Organizations with unpredictable namespace patterns
- Teams that need ownership transfer capabilities
- Environments where kubectl read access is not a concern

**Caveat**: Higher operational complexity (webhook, TLS certs, HTTP API)

---

## 14. Open Questions for Team Discussion

1. **Namespace Organization**: Can we map consumer teams to namespaces (PR #344), or do we need flexible organization (PR #346)?

2. **kubectl Read Access**: Is it acceptable for consumers to see other consumers' APIKey metadata via kubectl (PR #346 limitation)?

3. **Ownership Transfer**: Do we need admins to transfer APIProducts between teams (PR #346 feature)?

4. **Operational Complexity**: Are we comfortable managing webhooks and TLS certificates (PR #346), or prefer simpler deployment (PR #344)?

5. **GitOps Priority**: How important is kubectl-first workflows vs console UI?

6. **Shared vs. Isolated Namespaces**: Do we expect consumers to share namespaces (PR #346 better) or have dedicated namespaces (PR #344 better)?

---

## 15. Three-Way Comparison: Key Decisions

### Decision Matrix

| Decision Point | PR #344 (Namespace) | PR #346 (Ownership) | RHDH/Backstage |
|----------------|---------------------|---------------------|----------------|
| **Ownership tracking** | None (namespace = ownership) | `kuadrant.io/created-by` + `status.owner` | `backstage.io/owner` annotation |
| **Enforcement mechanism** | K8s RBAC | Webhook + HTTP API | Backend plugin |
| **kubectl protection** | ✅ Full (RBAC blocks) | ✅ Full (webhook blocks) | ❌ None (backend only) |
| **Consumer isolation** | ✅ Namespace boundaries | ⚠️ Server-side filtering | ⚠️ Backend filtering |
| **APIKey namespace** | Consumer's namespace | Consumer's namespace | **Owner's namespace** |
| **Approval mechanism** | APIKeyApproval CRD | APIKeyApproval CRD | Direct status update |
| **Components needed** | None | Webhook + HTTP API | Backend plugin |
| **TLS cert management** | ❌ Not needed | ⚠️ Required (webhook) | ❌ Not needed |
| **Ownership transfer** | ❌ Not supported | ✅ Admin can transfer | ❌ Not supported (immutable) |
| **GitOps friendly** | ✅ Fully compatible | ✅ Works (reads show all) | ⚠️ Backend required |
| **Shared namespace support** | ⚠️ Pattern 1 (no isolation) | ✅ Works with any org | ✅ All in owner NS |
| **Consistency with RHDH** | ❌ Different model | ✅ Similar (adds webhook) | ✅ Same tool |

### Alignment with RHDH/Backstage

**Critical question**: Should the console plugin align with the RHDH/Backstage model?

#### Arguments for Alignment (PR #346 closer):

1. **Consistency across UIs**: Users switching between Backstage and Console see similar RBAC model
2. **Shared ownership field**: `backstage.io/owner` or `kuadrant.io/created-by` both track ownership explicitly
3. **Same persona model**: Consumer/Owner/Admin hierarchy matches RHDH
4. **Easier migration**: If users move from RHDH to Console, model is familiar
5. **Single source of truth**: Ownership in annotations, not derived from namespace

#### Arguments Against Alignment (PR #344 approach):

1. **Different tools, different patterns**: Console is K8s-native, Backstage is abstraction layer
2. **Stronger security**: K8s RBAC is more robust than backend filtering
3. **Lower complexity**: No webhook/certs/backend needed
4. **kubectl-first**: Console should embrace K8s primitives, not abstract them
5. **Better isolation**: Namespace boundaries prevent kubectl bypass

### APIKey Namespace Placement: Critical Difference

**RHDH/Backstage current behavior:**
- APIKey in **owner's namespace** (same as APIProduct)
- Secret in **owner's namespace**
- ⚠️ Consumers need write permissions in owner's namespace

**Both PR #344 and PR #346:**
- APIKey in **consumer's namespace**
- Secret in **consumer's namespace**
- ✅ Consumers isolated from each other

**This is a breaking change from RHDH!**

#### Migration Path Options:

**Option 1: Keep RHDH behavior**
- APIKey in owner's namespace (match RHDH)
- **Problem**: Consumers need write permissions in owner's namespace
- **Problem**: No namespace isolation between consumers
- **Benefit**: No migration needed for existing RHDH APIKeys

**Option 2: Change to consumer namespace (both PRs)**
- APIKey in consumer's namespace
- **Benefit**: Better isolation, aligns with K8s security model
- **Problem**: Breaking change from RHDH (needs migration plan)
- **Problem**: developer-portal-controller must support both

**Recommendation**:
- Accept the breaking change (consumer namespace is more secure)
- Document migration path for RHDH users
- developer-portal-controller can watch both patterns during transition

### Approval Workflow: APIKeyApproval CRD

**RHDH/Backstage current:**
```yaml
# Approval is direct status update
status:
  phase: Approved
  reviewedBy: "bob@example.com"
  reviewedAt: "2026-03-30T14:00:00Z"
```

**Both PR #344 and PR #346:**
```yaml
# Approval is separate resource
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKeyApproval
metadata:
  name: mobile-app-payment-key-approval
  namespace: payment-services  # Owner's namespace
spec:
  apiKeyRef:
    name: mobile-app-payment-key
    namespace: consumer-team-mobile  # Consumer's namespace
  approved: true
  reviewedBy: "bob@payment-team.com"
```

**Why both PRs agree on this:**
- ✅ Cleaner RBAC separation (owners create APIKeyApproval, consumers cannot)
- ✅ No webhook needed for approval (namespace RBAC is enough)
- ✅ Cross-namespace reference works without special permissions
- ✅ Follows Kubernetes patterns (like CertificateSigningRequest)

**RHDH compatibility:**
- developer-portal-controller needs to watch both patterns:
  - Old: Direct `status.phase` updates (RHDH backend)
  - New: APIKeyApproval resources (Console plugin)
- Controller can support both during transition period

### Persona Mapping

| RHDH/Backstage | PR #344 | PR #346 |
|----------------|---------|---------|
| **API Consumer** | API Consumer | API Consumer |
| **API Owner** | API Owner | API Owner |
| **API Admin** | API Admin | API Admin (kuadrant-api-admins group) |
| **Platform Engineer** | Platform Engineer | Platform Engineer |

**Permission alignment**: All three models use the same four-persona hierarchy ✅

### Cross-Tool Compatibility

**Scenario**: User creates APIProduct in RHDH, consumer requests access via Console

**PR #344 approach:**
```
1. RHDH creates APIProduct in `payment-services`
2. Console consumer creates APIKey in `consumer-team-mobile` (different namespace)
3. Console owner approves via APIKeyApproval in `payment-services`
4. Controller reconciles (watches both status.phase and APIKeyApproval)
5. ✅ Works (assuming controller supports both approval patterns)
```

**PR #346 approach:**
```
1. RHDH creates APIProduct with `backstage.io/owner: bob`
2. Console creates APIProduct with `kuadrant.io/created-by: bob`
3. ⚠️ Two different ownership annotations
4. ❌ Console cannot determine ownership of RHDH-created APIProducts
5. ⚠️ Need to standardize on one annotation
```

**Ownership annotation conflict:**
- RHDH uses `backstage.io/owner` (standard Backstage pattern)
- PR #346 uses `kuadrant.io/created-by` (Kuadrant-specific)
- **Resolution needed**: Pick one or support both

**Option A: Use `backstage.io/owner` everywhere**
- ✅ Standard Backstage pattern
- ✅ RHDH compatibility
- ⚠️ Couples console plugin to Backstage

**Option B: Use `kuadrant.io/created-by` everywhere**
- ✅ Kuadrant-specific (no Backstage dependency)
- ⚠️ RHDH must migrate or support both

**Option C: Support both (read fallback)**
- Webhook sets `kuadrant.io/created-by`
- Controller also checks `backstage.io/owner` if no `kuadrant.io/created-by`
- ✅ Backward compatible with RHDH
- ⚠️ More complexity

## 16. Recommendation: Hybrid Approach

Based on the three-way comparison, here's a recommended hybrid approach:

### Core Design: PR #344 + Ownership Annotation

**Take from PR #344:**
- ✅ Namespace-based RBAC (native K8s enforcement)
- ✅ Consumer namespace placement (better isolation)
- ✅ No custom HTTP API server (direct K8s API)
- ✅ APIKeyApproval CRD (clean separation)

**Take from PR #346:**
- ✅ Ownership annotation for visibility (informational only)
- ✅ Webhook for APIKeyApproval validation (optional enhancement)
- ❌ Skip custom HTTP API (use K8s API directly)
- ❌ Skip ownership enforcement in webhook (RBAC is enough)

**Take from RHDH:**
- ✅ Use `backstage.io/owner` annotation (compatibility)
- ✅ Four-persona model (already aligned)
- ✅ `.own` / `.all` permission pattern (for UI hints)
- ❌ Don't replicate backend filtering (use RBAC instead)

### Implementation

```yaml
# APIProduct with ownership annotation (informational)
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIProduct
metadata:
  name: payment-api-v1
  namespace: payment-services
  annotations:
    backstage.io/owner: "user:default/bob"  # ← Set by UI, not enforced
spec:
  displayName: "Payment API v1"
status:
  owner: bob  # ← Mirrored from annotation for UI display (optional)
```

**RBAC enforcement:**
- Owners get RoleBinding in their namespace → can create/update/delete APIProducts
- Consumers get RoleBinding in their namespace → can create APIKeys
- Admins get ClusterRole → full access everywhere

**Ownership annotation:**
- Set by console plugin UI (for display purposes)
- NOT enforced by RBAC (namespace membership is the enforcement)
- Controller can mirror to `status.owner` for convenience
- Compatible with RHDH (same annotation format)

**Benefits:**
1. ✅ K8s native RBAC (simple, secure)
2. ✅ Ownership visibility (for UI/UX)
3. ✅ RHDH compatibility (same annotation)
4. ✅ No webhook complexity (RBAC is enough)
5. ✅ Consumer isolation (namespace boundaries)

**Trade-offs:**
- ⚠️ Ownership annotation not enforced (namespace RBAC is enforcement)
- ⚠️ kubectl can change annotation (but RBAC still enforces operations)
- ✅ Acceptable: Console plugin is for trusted K8s users

## 17. Next Steps

### Immediate Team Discussion

1. **RHDH Alignment**:
   - Should console plugin replicate RHDH model (PR #346) or diverge (PR #344)?
   - Are users expected to use both tools, or migrate from one to the other?
   - Is consistency across UIs more important than K8s-native security?

2. **Ownership Annotation**:
   - Use `backstage.io/owner` (RHDH compatible) or `kuadrant.io/created-by` (Kuadrant-specific)?
   - Should ownership be enforced (PR #346) or informational (PR #344 + annotation)?

3. **APIKey Namespace Placement**:
   - Accept breaking change: APIKey in consumer namespace (both PRs)?
   - Or maintain RHDH compatibility: APIKey in owner namespace?
   - Migration plan for existing RHDH APIKeys?

4. **Approval Mechanism**:
   - Adopt APIKeyApproval CRD (both PRs agree)?
   - developer-portal-controller supports both patterns (status.phase + APIKeyApproval)?
   - Transition plan for RHDH users?

5. **kubectl Protection**:
   - Is kubectl bypass acceptable (RHDH model)?
   - Or must we protect kubectl access (PR #344 RBAC or PR #346 webhook)?
   - Who are the target users (trusted ops vs. external developers)?

### Technical Validation

1. **Prototype both approaches** - Test deployment in dev cluster
2. **Measure complexity** - Operational overhead (certs, webhooks, RBAC setup)
3. **Validate use cases** - Real-world scenarios (shared namespace, namespace-per-team)
4. **RHDH integration test** - Create APIProduct in RHDH, approve in Console
5. **Migration testing** - Convert existing RHDH APIKeys to new model

### Documentation

1. **ADR (Architecture Decision Record)** - Document chosen approach and rationale
2. **Migration guide** - Path from RHDH to Console (if models differ)
3. **RBAC setup guide** - How to deploy chosen model
4. **Cross-tool compatibility** - Using RHDH + Console together

### Developer Portal Controller Changes

Regardless of PR choice, developer-portal-controller needs updates:

1. **APIKeyApproval CRD** - New resource for approval workflow (both PRs agree)
2. **Watch both approval patterns** - Support status.phase (RHDH) + APIKeyApproval (Console)
3. **Cross-namespace APIKey support** - APIKey in consumer namespace, APIProduct in owner namespace
4. **Ownership annotation support** - Read `backstage.io/owner` or `kuadrant.io/created-by` (or both)

### Decision Framework

Use this decision tree:

```
1. Are users expected to use RHDH AND Console together?
   YES → Prioritize alignment (PR #346 or hybrid)
   NO → Can diverge (PR #344 acceptable)

2. Do we need kubectl protection?
   YES → PR #344 (RBAC) or PR #346 (webhook)
   NO → RHDH model acceptable

3. Can we map teams to namespaces?
   YES → PR #344 (namespace isolation)
   NO → PR #346 (flexible organization)

4. Is operational simplicity critical?
   YES → PR #344 (no webhook/certs)
   NO → PR #346 acceptable

5. Do we need ownership transfer?
   YES → PR #346 (admin transfer)
   NO → PR #344 or RHDH model
```

---

## 18. Critical Integration Concerns

### Concern 1: APIKey Namespace Conflict

**RHDH behavior**: APIKey in owner's namespace
**Both PRs**: APIKey in consumer's namespace

**Impact**:
- Existing RHDH APIKeys will be in owner namespaces
- New Console APIKeys will be in consumer namespaces
- developer-portal-controller must watch both patterns
- Migration path needed for existing APIKeys

**Resolution Options**:

**A) Accept the divergence**:
- RHDH continues creating in owner namespace
- Console creates in consumer namespace
- Controller watches both (no migration needed)
- ⚠️ Confusing for users (different behavior per UI)

**B) Migrate RHDH to consumer namespace**:
- Update RHDH backend to create in consumer namespace
- Requires changes to kuadrant-backstage-plugin
- ✅ Consistent behavior across UIs
- ⚠️ Breaking change for RHDH users

**C) Console follows RHDH pattern (owner namespace)**:
- Console creates APIKey in owner namespace (like RHDH)
- No migration needed
- ❌ Loses namespace isolation benefits (both PRs agree this is worse)

**Recommendation**: Accept divergence (Option A) initially, migrate RHDH later (Option B)

### Concern 2: Ownership Annotation Conflict

**RHDH uses**: `backstage.io/owner: "user:default/bob"`
**PR #346 uses**: `kuadrant.io/created-by: "bob"`
**PR #344 uses**: No annotation (namespace membership)

**Impact**:
- APIProducts created in RHDH have `backstage.io/owner`
- APIProducts created in Console (PR #346) have `kuadrant.io/created-by`
- Console cannot determine ownership of RHDH-created APIProducts

**Resolution Options**:

**A) Standardize on `backstage.io/owner`**:
- Console sets `backstage.io/owner` (same format as RHDH)
- ✅ Full compatibility
- ⚠️ Couples console to Backstage

**B) Support both (fallback reading)**:
- Console sets `kuadrant.io/created-by`
- Console reads `backstage.io/owner` if no `kuadrant.io/created-by`
- ✅ Backward compatible
- ⚠️ More complexity

**C) No annotation in Console (PR #344)**:
- Console doesn't use ownership annotations
- RHDH continues using `backstage.io/owner`
- ✅ No conflict (different models)
- ⚠️ Cannot show "owner" in Console UI

**Recommendation**: Option A (standardize on `backstage.io/owner`) if choosing PR #346, Option C if choosing PR #344

### Concern 3: Approval Workflow Divergence

**RHDH current**:
```yaml
# Approval via direct status update
status:
  phase: Approved
  reviewedBy: "bob@example.com"
  reviewedAt: "2026-03-30T14:00:00Z"
```

**Both PRs propose**:
```yaml
# Approval via separate CRD
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKeyApproval
metadata:
  name: approval-for-alice-request
  namespace: payment-services
spec:
  apiKeyRef:
    name: alice-request
    namespace: consumer-team-mobile
  approved: true
```

**Impact**:
- RHDH backend directly updates `status.phase`
- Console creates APIKeyApproval resources
- developer-portal-controller must watch both patterns

**Resolution**:
- Controller supports **both approval patterns**:
  1. Watch `status.phase` changes (RHDH path)
  2. Watch APIKeyApproval resources (Console path)
  3. Reconcile to same outcome (create Secret)
- ✅ No breaking change for RHDH
- ✅ Both UIs can coexist

**Implementation**:
```go
// In developer-portal-controller
func (r *APIKeyReconciler) Reconcile(ctx context.Context, req ctrl.Request) {
    apiKey := &APIKey{}
    r.Get(ctx, req.NamespacedName, apiKey)

    // Check RHDH-style approval (status.phase)
    if apiKey.Status.Phase == "Approved" {
        return r.createSecret(ctx, apiKey)
    }

    // Check Console-style approval (APIKeyApproval CRD)
    approval := &APIKeyApproval{}
    err := r.Get(ctx, types.NamespacedName{
        Namespace: apiKey.Spec.APIProductRef.Namespace,
        Name:      fmt.Sprintf("approval-%s", apiKey.Name),
    }, approval)

    if err == nil && approval.Spec.Approved {
        apiKey.Status.Phase = "Approved"
        r.Status().Update(ctx, apiKey)
        return r.createSecret(ctx, apiKey)
    }

    return ctrl.Result{}, nil
}
```

### Concern 4: Secret Access and Revelation

**RHDH current**:
- Secret in owner's namespace (same as APIProduct)
- Consumer retrieves secret via backend API (backend reads Secret, returns to frontend)
- `status.canReadSecret` flag controls one-time revelation

**Both PRs**:
- Secret in consumer's namespace
- Consumer reads Secret directly from K8s API (via console plugin)
- Consumer has `get secrets` permission in own namespace

**Impact**:
- Different secret access patterns
- RHDH hides secret value after first view (one-time)
- Console allows repeated access (consumer can read Secret anytime)

**Resolution**:
- Keep different patterns (different security models)
- RHDH: Backend-mediated access (one-time reveal)
- Console: Direct K8s access (repeated access)
- ✅ Acceptable: Different UIs, different user expectations

### Concern 5: Consumer Permissions

**RHDH current**:
- Consumer creates APIKey in owner's namespace
- Consumer needs `create apikeys` permission in owner's namespace
- ⚠️ All consumers have write access to owner's namespace

**PR #344**:
- Consumer creates APIKey in own namespace
- Consumer has RoleBinding in own namespace only
- ✅ No write access to owner's namespace

**PR #346**:
- Consumer creates APIKey in own namespace
- Webhook auto-sets requester
- ✅ No write access to owner's namespace

**Impact**:
- Console consumers don't need permissions in owner namespace (more secure)
- RHDH consumers have broader permissions (potential privilege escalation)

**Resolution**:
- Accept that Console is more restrictive (better security)
- RHDH can migrate to consumer namespace model in future

## 19. RHDH Integration Scenarios

### Scenario 1: User Creates APIProduct in RHDH, Consumer Requests via Console

**Flow**:
1. Owner creates APIProduct via RHDH → `backstage.io/owner: user:default/bob`
2. Consumer browses catalog in Console (cluster-wide read)
3. Consumer requests access via Console → creates APIKey in `consumer-team-mobile`
4. Owner views approval queue in Console
   - **PR #344**: Filters by namespace RBAC
   - **PR #346**: Filters by ownership (needs to read `backstage.io/owner`)
5. Owner approves via Console → creates APIKeyApproval
6. Controller reconciles → creates Secret

**Issues**:
- ✅ Works if Console reads `backstage.io/owner` annotation (PR #346)
- ⚠️ Might not work with PR #344 (no ownership tracking)

### Scenario 2: User Creates APIProduct in Console, Consumer Requests via RHDH

**Flow**:
1. Owner creates APIProduct via Console
   - **PR #344**: No ownership annotation
   - **PR #346**: Sets `kuadrant.io/created-by: bob`
2. RHDH entity provider syncs APIProduct to Backstage catalog
   - **Issue**: RHDH expects `backstage.io/owner` annotation
   - **Result**: APIProduct not synced (RHDH skips products without owner)
3. Consumer cannot see product in RHDH

**Resolution**:
- Console must set `backstage.io/owner` annotation (even if using PR #344)
- OR RHDH entity provider updated to read `kuadrant.io/created-by`

### Scenario 3: Both UIs Used Interchangeably

**Flow**:
1. Owner creates APIProduct in RHDH → `backstage.io/owner: user:default/bob`
2. Consumer requests via Console → APIKey in consumer namespace
3. Owner approves via RHDH → updates `status.phase: Approved`
4. Controller creates Secret in consumer namespace
5. Consumer retrieves key via Console → reads Secret

**Issues**:
- ✅ Works if controller supports both approval patterns
- ✅ Works if RHDH backend can update APIKeys in consumer namespaces
- ⚠️ RHDH backend needs RBAC to update APIKeys in all namespaces

## 20. Final Recommendation with RHDH Context

Given the RHDH/Backstage ecosystem, here's the recommended approach:

### Choose: Hybrid of PR #344 + RHDH Compatibility

**Core architecture**: PR #344 (namespace-based RBAC)
**Additions for RHDH compatibility**:
1. ✅ Set `backstage.io/owner` annotation (informational, not enforced)
2. ✅ Mirror to `status.owner` for UI display
3. ✅ Support APIKeyApproval CRD (both RHDH and Console can approve)
4. ✅ APIKey in consumer namespace (secure, but different from RHDH)

**Why this works**:
- K8s native RBAC (simple, secure, no webhook/certs)
- Compatible with RHDH (same ownership annotation format)
- Stronger isolation (consumer namespace, not owner namespace)
- No breaking changes to RHDH workflow (controller supports both)
- Clean migration path (RHDH can adopt console patterns over time)

**Changes needed**:

**In console-plugin**:
- Set `backstage.io/owner` when creating APIProducts
- Display `status.owner` in UI (for visibility)
- Use K8s RBAC (RoleBindings per namespace)
- Create APIKeyApproval resources for approval

**In developer-portal-controller**:
- Watch both `status.phase` (RHDH) and APIKeyApproval (Console)
- Mirror `backstage.io/owner` → `status.owner`
- Support APIKey in both owner namespace (RHDH) and consumer namespace (Console)
- No breaking changes to RHDH

**In kuadrant-backstage-plugin** (future):
- Migrate to consumer namespace for APIKeys
- Adopt APIKeyApproval CRD for approvals
- Keep `backstage.io/owner` annotation (already using)

## Appendix: Side-by-Side Code Examples

### Creating an APIKey

**PR #344 (kubectl)**:
```bash
# Consumer creates in their namespace (RBAC enforced)
cat <<EOF | kubectl apply -f - --as=alice
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKey
metadata:
  name: my-key
  namespace: consumer-team-mobile  # alice has RoleBinding here
spec:
  apiProductRef:
    name: payment-api
    namespace: payment-services
  planTier: gold
EOF

# If alice tries other namespace → RBAC denies
kubectl apply -f - -n other-team  # ERROR: Forbidden
```

**PR #346 (console + webhook)**:
```bash
# Consumer creates (webhook sets owner)
cat <<EOF | kubectl apply -f - --as=alice
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKey
metadata:
  name: my-key
  namespace: consumer-team-mobile
spec:
  apiProductRef:
    name: payment-api
    namespace: payment-services
  planTier: gold
  # NO requester field - webhook sets it
EOF

# Webhook mutates before storage:
# annotations:
#   kuadrant.io/created-by: alice
# spec:
#   requester: alice  # ← set by webhook
```

### Listing APIKeys

**PR #344 (kubectl)**:
```bash
# Alice can only list in her namespace
kubectl get apikeys -n consumer-team-mobile --as=alice  # ✅ Works
kubectl get apikeys -A --as=alice  # ❌ Forbidden (RBAC)

# Owner can list cluster-wide
kubectl get apikeys -A --as=payment-owner  # ✅ Works (discover requests)
```

**PR #346 (kubectl + console)**:
```bash
# kubectl: Alice can see all (metadata only, not secrets)
kubectl get apikeys -A --as=alice  # ✅ Works, but sees all metadata

# Console UI: Calls HTTP API (server-side filtered)
GET /api/v1/apikeys/my-keys
→ Returns only alice's keys
```
