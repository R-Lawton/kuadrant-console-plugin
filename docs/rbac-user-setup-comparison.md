# User Setup Documentation Requirements: PR #344 vs PR #346

## Executive Summary

This document compares what users need to know and do to properly use the OpenShift Console Plugin under each RBAC approach.

**TL;DR**:
- **PR #344**: Users must understand namespace organization and RBAC setup (more K8s knowledge required)
- **PR #346**: Users work naturally, ownership is automatic (less K8s knowledge required)

---

## PR #344: Namespace-Based RBAC

### Required User Knowledge

Users must understand:

1. **Namespace Organization Model**
   - Which namespace pattern is deployed (shared vs. per-team)
   - Which namespace(s) they have access to
   - Where to create each resource type (APIProduct vs APIKey)

2. **RBAC Concepts**
   - What a RoleBinding is and why it matters
   - How namespace boundaries work
   - Why they can/cannot access certain namespaces

3. **Resource Placement Rules**
   - API Owners create APIProducts in **their assigned namespace**
   - Consumers create APIKeys in **their assigned namespace**
   - Cross-namespace references work automatically (no special permissions needed)

### Platform Admin Setup Documentation

#### 1. Choose Namespace Pattern

**Pattern 1: Single Shared Consumer Namespace** (simpler, less isolation)

```bash
# Create shared consumer namespace
kubectl create namespace api-consumers

# Apply ClusterRoles (once)
kubectl apply -f config/rbac/api-consumer-role.yaml
kubectl apply -f config/rbac/api-owner-role.yaml

# Bind all consumers to shared namespace
kubectl create rolebinding api-consumer-binding \
  --clusterrole=api-consumer \
  --group=developers \
  -n api-consumers

# Grant catalog read access (cluster-wide)
kubectl create clusterrolebinding api-consumer-catalog-reader \
  --clusterrole=api-consumer-catalog-reader \
  --group=developers
```

**Documentation Required**:
- ✅ "All consumers create APIKeys in the `api-consumers` namespace"
- ✅ "You can see other consumers' APIKey metadata in the shared namespace"
- ✅ "Use the 'My Keys' filter in the UI to see only your requests"
- ⚠️ **User Impact**: Must remember which namespace to use

---

**Pattern 2: Namespace-Per-Team** (more complex, stronger isolation)

```bash
# Create namespace for each team
kubectl create namespace consumer-team-mobile
kubectl create namespace consumer-team-backend
kubectl create namespace api-team-payments

# Apply ClusterRoles (once)
kubectl apply -f config/rbac/api-consumer-role.yaml
kubectl apply -f config/rbac/api-owner-role.yaml

# Bind mobile team to their namespace
kubectl create rolebinding api-consumer-binding \
  --clusterrole=api-consumer \
  --group=mobile-team \
  -n consumer-team-mobile

# Grant catalog read access
kubectl create clusterrolebinding api-consumer-catalog-mobile \
  --clusterrole=api-consumer-catalog-reader \
  --group=mobile-team

# Bind payment API owners to their namespace
kubectl create rolebinding api-owner-binding \
  --clusterrole=api-owner \
  --group=payment-api-team \
  -n api-team-payments

# Grant owner discovery access
kubectl create clusterrolebinding api-owner-catalog-payments \
  --clusterrole=api-owner-catalog-reader \
  --group=payment-api-team
```

**Documentation Required**:
- ✅ "Mobile team creates APIKeys in `consumer-team-mobile` namespace"
- ✅ "Payment team creates APIProducts in `api-team-payments` namespace"
- ✅ "You cannot create resources in other teams' namespaces"
- ✅ "Namespace selector in UI is pre-filtered to your allowed namespaces"
- ⚠️ **User Impact**: Must know which namespace they belong to

#### 2. User Onboarding Documentation

**For API Consumers:**

```markdown
# Getting Started as an API Consumer

## Your Namespace
You have been assigned to the `consumer-team-mobile` namespace.

## Creating API Access Requests

1. Browse the API Catalog (all namespaces visible)
2. Click "Request Access" on any API
3. **IMPORTANT**: In the namespace dropdown, select `consumer-team-mobile`
4. Fill out the request form
5. Submit

## Why the namespace matters
- You can only create APIKeys in `consumer-team-mobile`
- Trying to create in other namespaces will fail with "Forbidden"
- Your team admin has set up RBAC permissions for this namespace

## Viewing Your Requests

Navigate to: **API Management → My API Keys**

Filter: Select `consumer-team-mobile` namespace

You will see:
- ✅ Your own APIKey requests in your namespace
- ❌ NOT other teams' requests (RBAC blocks)

## Troubleshooting

**Error: "Forbidden: cannot create apikeys in namespace X"**
→ You tried to create in the wrong namespace
→ Use `consumer-team-mobile` instead

**Error: "No namespace selected"**
→ Click the namespace dropdown and select `consumer-team-mobile`
```

**For API Owners:**

```markdown
# Getting Started as an API Owner

## Your Namespace
You manage APIs in the `api-team-payments` namespace.

## Publishing an API

1. Navigate to: **API Management → API Products**
2. Click "Create API Product"
3. **IMPORTANT**: In the namespace dropdown, select `api-team-payments`
4. Select an HTTPRoute from your namespace
5. Configure approval mode and publish

## Why the namespace matters
- You can only create/edit APIProducts in `api-team-payments`
- You cannot modify APIProducts in other teams' namespaces
- RBAC enforces this automatically

## Approving Access Requests

Navigate to: **API Management → Approval Queue**

You will see:
- APIKey requests for APIs in `api-team-payments`
- Requests from ANY consumer namespace (mobile, backend, etc.)
- Filter works automatically based on your namespace permissions

To approve:
1. Click "Approve" on a request
2. System creates APIKeyApproval in `api-team-payments` namespace
3. Consumer receives their API key in their namespace

## Cross-Namespace References (How It Works)

Consumer creates:
```yaml
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKey
metadata:
  name: my-request
  namespace: consumer-team-mobile  # ← Consumer's namespace
spec:
  apiProductRef:
    name: payment-api
    namespace: api-team-payments  # ← Your namespace (cross-ref)
```

You approve:
```yaml
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIKeyApproval
metadata:
  name: approval-for-my-request
  namespace: api-team-payments  # ← Your namespace
spec:
  apiKeyRef:
    name: my-request
    namespace: consumer-team-mobile  # ← Consumer's namespace (cross-ref)
  approved: true
```

**No special permissions needed for cross-namespace references.**

## Troubleshooting

**Error: "Forbidden: cannot create apiproducts in namespace X"**
→ You tried to create in another team's namespace
→ Use `api-team-payments` instead

**"I don't see any requests in the approval queue"**
→ Check that your APIProducts are in `api-team-payments`
→ Only requests for APIs in your namespace appear
```

#### 3. Common Pitfalls Documentation

```markdown
# Common Mistakes with Namespace-Based RBAC

## Mistake 1: Creating Resources in the Wrong Namespace

**Symptom**: "Forbidden" error when clicking Create

**Cause**: Namespace dropdown set to a namespace you don't have access to

**Fix**:
1. Check the namespace dropdown (top of form)
2. Select your assigned namespace:
   - Consumers: `consumer-team-mobile` (or your team namespace)
   - Owners: `api-team-payments` (or your team namespace)

## Mistake 2: Expecting to See All APIKeys

**Symptom**: "I created an APIKey but don't see it in the list"

**Cause**: You're viewing a different namespace

**Fix**:
1. Check namespace filter (top of page)
2. Select your team's namespace
3. RBAC prevents you from listing APIKeys in other teams' namespaces

## Mistake 3: Trying to Approve Requests for Other Teams' APIs

**Symptom**: "No requests in approval queue"

**Cause**: Approval queue only shows requests for APIs in YOUR namespace

**How It Works**:
- You own APIProducts in `api-team-payments`
- Consumer creates APIKey in `consumer-team-mobile`
- APIKey references your APIProduct via `spec.apiProductRef.namespace: api-team-payments`
- You see the request because it references YOUR namespace
- You create APIKeyApproval in YOUR namespace

## Mistake 4: Forgetting Namespace Context

**Symptom**: "Why can't I edit this APIProduct?"

**Cause**: APIProduct is in another team's namespace

**How to Check**:
1. Look at the APIProduct details
2. Check the namespace field
3. You can only edit APIProducts in your namespace
4. Use "My API Products" filter to see only yours
```

---

## PR #346: Ownership-Based RBAC

### Required User Knowledge

Users need to understand:

1. **Automatic Ownership**
   - Resources are automatically owned by whoever creates them
   - Ownership is invisible (never shown in UI)
   - You can only edit resources you own

2. **Admin Group** (for admins only)
   - `kuadrant-api-admins` group exists
   - Admins can transfer ownership between users
   - Regular users cannot change ownership

3. **Resource Placement** (same as PR #344)
   - API Owners create APIProducts in any namespace they have access to
   - Consumers create APIKeys in their assigned namespace
   - Ownership is separate from namespace

### Platform Admin Setup Documentation

#### 1. Initial Setup

```bash
# Apply ClusterRoles (once)
kubectl apply -f config/rbac/api-owner-role.yaml
kubectl apply -f config/rbac/api-admin-clusterrole.yaml

# Create admin group
kubectl create group kuadrant-api-admins

# Add admins to group
kubectl patch user alice --type=json -p '[{"op":"add","path":"/groups/-","value":"kuadrant-api-admins"}]'
kubectl patch user bob --type=json -p '[{"op":"add","path":"/groups/-","value":"kuadrant-api-admins"}]'

# Webhook and HTTP API are deployed automatically with developer-portal-controller
# (TLS certs managed by cert-manager)
```

**Documentation Required**:
- ✅ "Ownership is tracked automatically - you don't need to specify an owner"
- ✅ "You can only edit APIProducts you created"
- ✅ "Admins can transfer ownership if needed"
- ⚠️ **User Impact**: Minimal - ownership is transparent

#### 2. User Onboarding Documentation

**For API Consumers:**

```markdown
# Getting Started as an API Consumer

## Creating API Access Requests

1. Browse the API Catalog
2. Click "Request Access" on any API
3. Select your namespace (e.g., `consumer-team-mobile`)
4. Fill out the request form
5. Submit

**Ownership is automatic** - the system tracks that you created this request.

## Viewing Your Requests

Navigate to: **API Management → My API Keys**

You will see:
- ✅ Only your own APIKey requests (server filters by your username)
- ❌ NOT other users' requests (server-side filtering)

**No namespace filtering needed** - the backend automatically shows only your keys.

## Troubleshooting

**Error: "Forbidden: cannot create apikeys"**
→ You don't have APIKey creation permissions
→ Contact your cluster admin

**"I don't see my APIKey in the list"**
→ Check that you're logged in as the same user who created it
→ Backend filters by logged-in username
```

**For API Owners:**

```markdown
# Getting Started as an API Owner

## Publishing an API

1. Navigate to: **API Management → API Products**
2. Click "Create API Product"
3. Select a namespace
4. Configure and publish

**Ownership is automatic** - the system marks you as the owner.

## Editing Your APIs

- ✅ Edit/Delete buttons appear for APIs you created
- ❌ Edit/Delete buttons hidden for others' APIs
- System enforces ownership (webhook blocks unauthorized changes)

## Approving Access Requests

Navigate to: **API Management → Approval Queue**

You will see:
- APIKey requests for APIs you own (automatic filtering)
- Requests from any consumer

To approve:
1. Click "Approve"
2. Request moves to "Approved" status
3. Consumer receives API key

## Ownership Transfer (Admins Only)

If you need to transfer an API to another owner:
1. Contact a platform admin
2. Admin can reassign ownership
3. You will lose edit access after transfer

**Regular owners cannot transfer ownership.**

## Troubleshooting

**Error: "You can only update APIProducts you own"**
→ You tried to edit someone else's APIProduct
→ Contact admin if ownership transfer is needed

**"I don't see edit/delete buttons on my APIProduct"**
→ Check that you created this APIProduct
→ Check that you're logged in as the correct user
→ Ownership may have been transferred
```

#### 3. Admin Documentation

```markdown
# Admin Guide: Ownership Transfer

## Viewing Ownership

Ownership is tracked in two places:
1. `metadata.annotations["kuadrant.io/created-by"]` - set by webhook
2. `status.owner` - mirrored by controller

To check ownership:
```bash
kubectl get apiproduct payment-api -n payment-services -o yaml
```

Look for:
```yaml
metadata:
  annotations:
    kuadrant.io/created-by: alice
status:
  owner: alice
```

## Transferring Ownership

Only admins in `kuadrant-api-admins` group can transfer.

```bash
# Transfer APIProduct from alice to bob
kubectl annotate apiproduct payment-api \
  kuadrant.io/created-by=bob \
  --overwrite \
  -n payment-services

# Controller will update status.owner automatically
```

**Warning**: This immediately removes alice's edit access.

## Creating Resources on Behalf of Users

As an admin, you can create resources and set ownership:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: devportal.kuadrant.io/v1alpha1
kind: APIProduct
metadata:
  name: new-api
  namespace: payment-services
  annotations:
    kuadrant.io/created-by: alice  # alice will be the owner
spec:
  displayName: "New API"
EOF
```

**Note**: Webhook normally sets this annotation, but admins can override.
```

---

## Side-by-Side Comparison: User Experience

### Scenario 1: Creating an APIProduct

**PR #344 (Namespace-Based):**
```
1. User navigates to "Create API Product"
2. User sees namespace dropdown
3. ⚠️ User must remember their assigned namespace
4. User selects "api-team-payments" from dropdown
5. User fills form and submits
6. ✅ Created (if correct namespace)
7. ❌ "Forbidden" error (if wrong namespace)

User must know: "Which namespace am I assigned to?"
```

**PR #346 (Ownership-Based):**
```
1. User navigates to "Create API Product"
2. User sees namespace dropdown
3. User selects any namespace they have access to
4. User fills form and submits
5. ✅ Created (webhook sets owner automatically)
6. User sees edit buttons on this product (ownership applied)

User must know: Nothing extra - ownership is automatic
```

**Winner**: PR #346 (simpler user experience)

---

### Scenario 2: Viewing My APIKeys

**PR #344 (Namespace-Based):**
```
1. User navigates to "My API Keys"
2. User sees namespace filter dropdown
3. ⚠️ User must select their namespace
4. User selects "consumer-team-mobile"
5. List shows APIKeys in that namespace
6. ⚠️ If Pattern 1 (shared), user sees others' keys too
7. UI client-side filters by requestedBy.userId

User must know: "Which namespace are my keys in?"
```

**PR #346 (Ownership-Based):**
```
1. User navigates to "My API Keys"
2. Backend automatically filters by logged-in user
3. List shows only user's keys (server-side filtered)
4. No namespace selection needed

User must know: Nothing - filtering is automatic
```

**Winner**: PR #346 (simpler, no namespace awareness needed)

---

### Scenario 3: Approving Access Requests

**PR #344 (Namespace-Based):**
```
1. Owner navigates to "Approval Queue"
2. System shows APIKeys where:
   - spec.apiProductRef.namespace == owner's namespace
3. ✅ Automatic filtering by namespace RBAC
4. Owner clicks "Approve"
5. System creates APIKeyApproval in owner's namespace

User must know: "Requests appear if they reference my namespace"
```

**PR #346 (Ownership-Based):**
```
1. Owner navigates to "Approval Queue"
2. Backend filters APIKeys where:
   - Referenced APIProduct's status.owner == current user
3. ✅ Automatic filtering by ownership
4. Owner clicks "Approve"
5. Backend validates ownership before approval

User must know: "Requests appear for APIs I own"
```

**Winner**: Tie (both automatic, different mechanisms)

---

### Scenario 4: Trying to Edit Someone Else's APIProduct

**PR #344 (Namespace-Based):**
```
1. User views APIProduct in another team's namespace
2. ❌ Edit/Delete buttons hidden (client-side check)
3. If user tries kubectl:
   kubectl edit apiproduct payment-api -n other-team
4. ❌ "Forbidden" (K8s RBAC blocks)

Error: "User alice cannot update apiproducts in namespace other-team"
```

**PR #346 (Ownership-Based):**
```
1. User views APIProduct owned by someone else
2. ❌ Edit/Delete buttons hidden (client-side check)
3. If user tries kubectl:
   kubectl edit apiproduct payment-api -n any-namespace
4. ❌ Webhook blocks with ownership check

Error: "You can only update APIProducts you own"
```

**Winner**: PR #346 (more explicit error message)

---

## Documentation Complexity Comparison

### PR #344 Documentation Burden

**Platform Admin Docs**:
- ✅ RBAC setup guide (RoleBindings per namespace)
- ✅ Namespace pattern selection guide
- ✅ User onboarding checklist (assign namespace)
- ✅ Troubleshooting guide (wrong namespace errors)

**User Docs**:
- ✅ "What is my namespace?" FAQ
- ✅ "Why can't I create in namespace X?" troubleshooting
- ✅ Namespace selector usage guide
- ✅ Cross-namespace reference explanation

**Estimated pages**: 8-10 pages

---

### PR #346 Documentation Burden

**Platform Admin Docs**:
- ✅ Admin group setup (`kuadrant-api-admins`)
- ✅ Ownership transfer guide (admin only)
- ⚠️ Webhook/TLS cert troubleshooting (if issues arise)

**User Docs**:
- ✅ "Ownership is automatic" (1 paragraph)
- ✅ "Edit buttons appear for your resources" (1 paragraph)
- ✅ Basic usage guide (no namespace awareness needed)

**Estimated pages**: 4-5 pages

---

## Required Training/Onboarding

### PR #344: What Users Must Learn

**API Consumers:**
1. ✅ Which namespace they belong to
2. ✅ Always select correct namespace in dropdown
3. ✅ Why they can't access other namespaces
4. ✅ How to filter "My Keys" by namespace

**API Owners:**
1. ✅ Which namespace they manage
2. ✅ Create APIProducts in their namespace only
3. ✅ Approval queue shows requests for their namespace
4. ✅ Cross-namespace references (how they work)

**Admins:**
1. ✅ RBAC setup (RoleBindings per user/team)
2. ✅ Namespace planning (shared vs. per-team)
3. ✅ User namespace assignment

**Onboarding Time**: 30-45 minutes per role

---

### PR #346: What Users Must Learn

**API Consumers:**
1. ✅ Ownership is automatic (don't worry about it)
2. ✅ Select a namespace (any they have access to)

**API Owners:**
1. ✅ Ownership is automatic (don't worry about it)
2. ✅ Edit/delete only works for resources you created
3. ✅ Contact admin for ownership transfers

**Admins:**
1. ✅ Admin group membership (`kuadrant-api-admins`)
2. ✅ How to transfer ownership (annotation edit)
3. ⚠️ Webhook/TLS cert management (if issues)

**Onboarding Time**: 15-20 minutes per role

---

## Error Messages Users Will See

### PR #344 Error Messages

```
Error: Forbidden
User "alice" cannot create apiproducts in namespace "other-team-namespace"

→ User tried to create in wrong namespace
→ Guide user to their assigned namespace
```

```
Error: Forbidden
User "alice" cannot list apikeys in namespace "other-team-namespace"

→ User tried to view other team's namespace
→ Guide user to select their namespace filter
```

```
Error: No namespace selected
Please select a namespace from the dropdown

→ User forgot to select namespace
→ Guide user to select their assigned namespace
```

### PR #346 Error Messages

```
Error: You can only update APIProducts you own

→ User tried to edit someone else's APIProduct
→ Guide user to contact admin for ownership transfer
```

```
Error: You can only approve APIKeys for APIProducts you own

→ User tried to approve request for someone else's API
→ Explain ownership-based approval queue
```

```
Error: Only admins can transfer ownership

→ User tried to edit kuadrant.io/created-by annotation
→ Guide user to contact admin
```

---

## Quick Reference Cards

### PR #344 User Quick Reference

```
┌─────────────────────────────────────────────────────┐
│ Quick Reference: Using the API Portal               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ YOUR NAMESPACE: consumer-team-mobile                │
│                                                     │
│ ✅ DO:                                              │
│ • Always select "consumer-team-mobile" in dropdown │
│ • Create APIKeys in your namespace                 │
│ • Browse catalog across all namespaces             │
│                                                     │
│ ❌ DON'T:                                           │
│ • Try to create in other teams' namespaces         │
│ • Expect to edit APIProducts (consumers can't)     │
│                                                     │
│ 📍 Common Tasks:                                    │
│ Request Access → Select "consumer-team-mobile"     │
│ View My Keys → Filter by "consumer-team-mobile"    │
│                                                     │
│ 🆘 Help: If you see "Forbidden" errors, check      │
│    that you selected the correct namespace         │
└─────────────────────────────────────────────────────┘
```

### PR #346 User Quick Reference

```
┌─────────────────────────────────────────────────────┐
│ Quick Reference: Using the API Portal               │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 🤖 OWNERSHIP IS AUTOMATIC                           │
│                                                     │
│ ✅ YOU CAN:                                         │
│ • Create APIProducts (you'll own them)             │
│ • Edit/delete resources you created                │
│ • Approve requests for your APIs                   │
│                                                     │
│ ❌ YOU CANNOT:                                      │
│ • Edit other users' APIProducts                    │
│ • See other users' API keys                        │
│ • Transfer ownership (contact admin)               │
│                                                     │
│ 📍 How to Tell if You Own Something:                │
│ • Edit/Delete buttons visible = you own it         │
│ • Buttons hidden = someone else owns it            │
│                                                     │
│ 🆘 Help: Contact admin for ownership transfers     │
└─────────────────────────────────────────────────────┘
```

---

## Summary: Documentation Requirements

| Documentation Type | PR #344 | PR #346 |
|-------------------|---------|---------|
| **Platform Admin Setup** | High (namespace planning, RBAC per team) | Medium (admin group, webhook auto-deployed) |
| **User Onboarding** | High (namespace awareness critical) | Low (ownership automatic) |
| **Troubleshooting Guide** | High (many namespace-related issues) | Medium (ownership transfer edge cases) |
| **FAQ Length** | Long (namespace questions) | Short (ownership transparent) |
| **Training Time** | 30-45 min per role | 15-20 min per role |
| **Error Message Clarity** | Technical (RBAC/namespace errors) | User-friendly (ownership errors) |
| **Quick Reference Card** | Detailed (namespace rules) | Simple (ownership automatic) |

---

## Recommendation

**For teams with strong K8s expertise**: PR #344
- Users understand namespaces and RBAC
- Can follow detailed setup documentation
- Prefer K8s-native patterns

**For teams with mixed expertise**: PR #346
- Simpler user experience (ownership automatic)
- Less documentation to maintain
- Fewer support tickets (fewer ways to make mistakes)

**For teams migrating from RHDH**: Hybrid (PR #344 + ownership annotation)
- K8s native RBAC (strong security)
- Ownership annotation for UX (informational)
- Balance between simplicity and K8s patterns
