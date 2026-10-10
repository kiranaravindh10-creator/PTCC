# PTCC — User Roles and Permissions

PTCC uses **role-based access control** with **branch-aware data scopes**:

- A **role** describes a job at PTCC (Marketing, Collection, …).
- A role grants **permissions**: named capabilities such as `task.assign.branch` or `marketing.read.all`.
- Many permissions come in up to three **widths**:
  - `.own`: records assigned to, created by or owned by me.
  - `.branch`: every record of my home branch.
  - `.all`: every branch (company-wide).
- Every person has a **home branch**, set by an Admin. Only the company-level roles (CEO, Admin) may have none.
- A person can hold **more than one role**. Their permissions are the union of their roles' permissions, and Home combines the relevant sections.

Permissions are enforced **on the server** for every page, action and API call. Hiding a button is a convenience, not security.

Changing an ID in a URL or an API request never reveals a record outside your scope. Out-of-scope records behave exactly like records that do not exist (404), and this is tested explicitly for cross-branch access.

---

## 1. Roles

| Role | Key | Works on | Branch | Primary device |
|---|---|---|---|---|
| CEO | `ceo` | Every branch: overview, comparisons, decisions, moving work and leads between branches | Company level | Desktop + phone |
| Admin | `admin` | People (branch + roles), branches, scope documents, activity log; routes leads between branches and owners | Company level | Desktop |
| HR / Coordinator | `hr` | Runs a branch day to day: assigns and balances work, schedules pickups/deliveries, routes leads | One branch | Desktop |
| Marketing manager | `marketing_manager` | Leads a branch's marketing team: sees all branch leads, assigns them, follows up | One branch | Desktop + phone |
| Marketing | `marketing` | Own leads, calls, follow-ups, quotations, deals | One branch | Desktop + phone |
| Collection | `collection` | Own pickups, deliveries, routes | One branch | Phone |
| Operations / Lab | `operations` | Receiving, calibration/testing, certificate, dispatch (Phase 5); sees the branch's pickups and deliveries | One branch | Desktop (lab) |
| Accounts | `accounts` | Payment follow-up and business status; accounting stays in Tally | One branch | Desktop |

- **Admin** administers the system. It sees leads company-wide **only to route them**: it can set or change a lead's branch and assign or reassign its owner (`lead.route`), and every routing action is audited. It cannot work leads (calls, stages, quotations, won/lost) or open the customer pages. A person who needs more can be given more roles.
- **Branch coordinators and marketing managers** assign and reassign the leads of their own branch (confirmed by PTCC). The CEO decides the branch of leads whose branch is unknown.

## 2. What each role sees

### Navigation

| | Home | My Work | Leads | Customers (+ Services) | Collections | Communication | Ask PTCC | Manage |
|---|---|---|---|---|---|---|---|---|
| CEO | Company overview, branch filter | ✓ | All branches | All | All | ✓ | Soon | People & access |
| Admin | Leads to route + own work | ✓ | All branches (routing) | — | — | ✓ | Soon | People & access |
| HR / Coordinator | Assignment + team (branch) | ✓ | Branch | Branch | Branch | ✓ | Soon | — |
| Marketing manager | Own sales day + branch marketing | ✓ | Branch | Branch | — | ✓ | Soon | — |
| Marketing | Own sales day | ✓ | Own | Branch | — | ✓ | Soon | — |
| Collection | Own route day | ✓ | Leads I added | — | Own | ✓ | Soon | — |
| Operations / Lab | Own work | ✓ | Leads I added | Branch | Branch | ✓ | Soon | — |
| Accounts | Own work | ✓ | Leads I added | Branch | — | ✓ | Soon | — |

Everyone can **add a lead** (`lead.capture`), for any branch or with the branch marked "Not sure". People who do not work leads only see the leads they added.

### Home, per role

| Role | Sections |
|---|---|
| CEO | Branch filter (All branches / each branch); work today; alerts (leads needing a branch or an owner); Marketing (period filter, more numbers on request, per person); Collections flow; Lab stages (Phase 5); branch comparison (on request); own work; team today |
| HR / Coordinator | Needs assignment; leads waiting for an owner; own work; team today (branch) |
| Marketing manager | Leads waiting for an owner; own sales day; branch marketing numbers |
| Marketing | Today's work (follow-ups, calls, new leads); next follow-up with Call · WhatsApp · Add note · Schedule; later today |
| Collection | Pickups, deliveries, overdue; next stop with Start route · Call · View |
| Admin | Leads that need a branch or an owner (to route); own work |
| Operations / Lab, Accounts | Own work and next item |

## 3. Permission catalogue

Permission **keys** are defined in code (`src/server/access/permissions.ts`) because code enforces them. Which roles hold which permissions is stored in the database. It is seeded from `src/server/access/roles.ts`, so it can be adjusted without a deployment.

`npm run db:sync-access` applies each default grant to a role **once**. A grant an Admin removes later is not put back.

| Permission | Meaning | CEO | Admin | HR | Mkt mgr | Mkt | Coll | Ops | Acc |
|---|---|---|---|---|---|---|---|---|---|
| `overview.company` | See the company overview for all branches, with a branch filter | ✓ |  |  |  |  |  |  |  |
| `team.view.branch` | See the open work and workload of people in my branch |  |  | ✓ |  |  |  |  |  |
| `team.view.all` | See open work and workload across all branches | ✓ |  |  |  |  |  |  |  |
| `task.read.own` | See work assigned to or created by me | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `task.read.branch` | See all work in my branch |  |  | ✓ |  |  |  |  |  |
| `task.read.all` | See all work in every branch | ✓ |  |  |  |  |  |  |  |
| `task.work` | Update and comment on work assigned to me | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `task.create` | Create work | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `task.assign.branch` | Assign or reassign work within my branch |  |  | ✓ |  |  |  |  |  |
| `task.assign.all` | Assign work in any branch, including moving it between branches | ✓ |  |  |  |  |  |  |  |
| `task.manage.branch` | Close or cancel any work in my branch |  |  | ✓ |  |  |  |  |  |
| `task.manage.all` | Close or cancel any work in every branch | ✓ |  |  |  |  |  |  |  |
| `collection.read.own` | Open Collections and see my own pickups and deliveries |  |  |  |  |  | ✓ |  |  |
| `collection.read.branch` | See every pickup and delivery in my branch |  |  | ✓ |  |  |  | ✓ |  |
| `collection.read.all` | See every pickup and delivery in the company | ✓ |  |  |  |  |  |  |  |
| `customer.read` | See customers linked to my branch (and search all names, to avoid duplicates) |  |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| `customer.read.all` | See every customer and its relationships with all branches | ✓ |  |  |  |  |  |  |  |
| `customer.write` | Add and edit customers and contacts; link a customer to my branch | ✓ |  | ✓ | ✓ | ✓ |  |  |  |
| `lead.capture` | Add a lead for any branch (or mark its branch as unknown) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `marketing.read.own` | See leads I own or added |  |  |  |  | ✓ |  |  |  |
| `marketing.read.branch` | See all leads, calls and quotations in my branch |  |  | ✓ | ✓ |  |  |  |  |
| `marketing.read.all` | See leads of every branch, including leads waiting for a branch | ✓ |  |  |  |  |  |  |  |
| `marketing.work` | Work my leads: calls, notes, follow-ups, stages, requirements, quotations, won/lost | ✓ |  |  | ✓ | ✓ |  |  |  |
| `marketing.assign.branch` | Assign and reassign leads within my branch, and work any of them |  |  | ✓ | ✓ |  |  |  |  |
| `marketing.assign.all` | Assign leads in any branch and decide which branch a lead belongs to | ✓ |  |  |  |  |  |  |  |
| `lead.route` | Route leads in every branch: set or change a lead's branch and assign or reassign its owner (audited) — without working the lead |  | ✓ |  |  |  |  |  |  |
| `catalogue.read` | Search PTCC's accredited calibration scope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `catalogue.manage` | Review the imported scope documents and accreditation certificates |  | ✓ |  |  |  |  |  |  |
| `user.manage` | Add people, set branch and roles, deactivate accounts, reset passwords | ✓ | ✓ |  |  |  |  |  |  |
| `role.manage` | View and change what each role can do |  | ✓ |  |  |  |  |  |  |
| `branch.manage` | Add and edit branches | ✓ | ✓ |  |  |  |  |  |  |
| `audit.read` | Read the activity (audit) log | ✓ | ✓ |  |  |  |  |  |  |

**Reserved for later phases.** These are not in the catalogue yet; they are added when their module is built:

- `parcel.receive` and `job.manage` (Phase 5);
- `finance.read` (Phase 6). This only reads what the Tally integration exposes; Tally stays the accounting system;
- `announcement.publish` (Phase 6);
- `ai.ask` and `knowledge.manage` (Phase 7).

### How a scope is resolved

`scopeOf(actor, capability)` in `src/server/access/actor.ts` returns the widest width a person holds, in this order:

1. `all`, if they hold `capability.all`;
2. `branch`, if they hold `capability.branch` **and** have a home branch;
3. `own`, if they hold `capability.own`;
4. otherwise `null`.

`coversBranch(actor, capability, branchId)` answers "may this person act on a record of that branch?". It is true for `all`. For `branch`, it is true only when the record's branch is their home branch. Records without a branch (e.g. a lead marked "Not sure") need `all`.

## 4. Data scope rules

Scopes are applied **inside the SQL query**, not after it. A list query for someone without `.all` never selects other branches' records.

| Record | Visible when… |
|---|---|
| Work (task) | `task.read.all`; **or** I am the assignee or creator; **or** `task.read.branch` and it is in my branch; **or** it is a pickup/delivery and `collection.read.all`, or `collection.read.branch` in my branch |
| Lead | `marketing.read.all` or `lead.route`; **or** I added it; **or** I own it (with any marketing read scope); **or** `marketing.read.branch` and it is in my branch |
| Lead activity (calls, notes) | The lead is visible to me, by the rules above |
| Customer (company) | `customer.read.all`; **or** `customer.read` and the company is linked to my branch; **or** I own or added one of its leads; **or** I am assigned work for it |
| Customer relationship per branch | Branch staff see only their branch's relationship (prospect/customer); `customer.read.all` sees every branch's |
| Company name suggestions | Everyone with `customer.read` or `lead.capture` can **search names** across all branches, so the same company is reused, never duplicated. Results carry the name and place only; contacts and business stay hidden. |
| Service scope (catalogue) | `catalogue.read` (everyone). It is controlled reference data, not customer data. |
| Notification | Only the recipient |
| Activity (audit) log | `audit.read` |
| People list (admin) | `user.manage` |

### Acting on records

| Action | Allowed for |
|---|---|
| Work: start, mark collected/delivered, complete, comment | The assignee (`task.work`), or `task.manage` covering the work's branch |
| Work: assign / reassign | `task.assign` covering the work's branch; with `.branch`, only to people of that branch. With `.all`, assigning someone of another branch moves the work to their branch (audited). |
| Work: create in another branch | `task.assign.all` only |
| Lead: work it (call, note, follow-up, stage, requirement, quotation, won/lost) | Its owner (`marketing.work`); the person who added it while it has no owner; or `marketing.assign` covering its branch |
| Lead: assign / reassign | `marketing.assign` covering its branch (Coordinator, Marketing manager: own branch; CEO: any), or `lead.route` (Admin: any). Always to a marketer (`marketing.work`) **of the lead's branch**. Audited. |
| Lead: set or change its branch | `marketing.assign.all` (CEO) or `lead.route` (Admin). Audited. |
| Lead: reopen a lost lead | `marketing.assign` covering its branch |
| Follow-ups | Only once the lead has a branch and an owner: a follow-up is work for the owner |
| Customer: add, edit, add contact, set my branch's relationship | `customer.write` (to the person's own branch unless `customer.read.all`) |
| People: add, set branch and roles, reset password, deactivate | `user.manage`. People with any branch-level role must have a branch. |
| Branches: add, edit, mark verified, deactivate | `branch.manage`. A branch with active people cannot be deactivated. |

### Who receives a new lead

The brief's rule is: lead → branch → marketing team → assigned employee.

1. **Branch known, added by one of its marketers:** that marketer owns it.
2. **Branch known, added by anyone else:** it waits under *Needs owner*. That branch's lead managers are notified: people with `marketing.assign.branch` there (Coordinator, Marketing manager). A manager assigns it to a marketer of that branch.
3. **Branch not known** ("Not sure — needs assignment", or an AI capture that does not name a branch exactly): it waits under *Needs branch*. People with `marketing.assign.all` (the CEO) are notified and decide the branch; Admin can also route it (`lead.route`). Rule 2 then applies.

Admin can route or reassign any lead at any step. Each change is in the activity log (`lead.branch`, `lead.assign` with before/after) and in the lead's own history. Tests: `tests/phase2-rules.test.ts` ("lead routing").

The system never guesses a branch.

## 5. Accounts and sign-in

- Accounts are created by an Admin. There is no public sign-up.
- The Admin sets the person's **branch** and **roles**. Branch-level roles require a branch; CEO and Admin may be company level.
- People sign in with their **mobile number or email** and a password. New accounts get a temporary password and must choose their own at first sign-in.
- Admins can **reset a password** (new temporary password; signs the person out everywhere) and **deactivate** an account (signs them out immediately; history is kept).
- **No OTP.** PTCC confirmed in Phase 2 that password sign-in stays. OTP is not planned.

## 6. Adding or changing a role

1. Add any new permission keys to `src/server/access/permissions.ts` with a clear description.
2. Add or adjust the role's defaults in `src/server/access/roles.ts`.
3. Run `npm run db:sync-access`. This:
   - inserts new permissions and new roles;
   - applies new default grants once;
   - removes retired permission keys.

   Grants an Admin added or removed are not overwritten.
4. Update this document.
