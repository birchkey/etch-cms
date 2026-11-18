# Etch CMS

A headless CMS that runs entirely on Cloudflare's infrastructure — no monthly SaaS bills, no servers to manage, no cold starts.

Etch gives you a full content management system — admin UI, REST API, asset storage, and scheduled publishing — all as a single Cloudflare Worker.

> **If Etch saves you money or time, consider [buying me a coffee](https://buymeacoffee.com/birchkey).** It helps keep the project maintained.

---

## Why Etch?

Most headless CMS options fall into one of two camps: expensive managed SaaS, or self-hosted tools that need a database server and regular maintenance. Etch takes a different approach by running entirely on Cloudflare's free-tier services:

- **D1** (SQLite) for the database
- **R2** for asset storage
- **Workers KV** for serving the admin SPA
- **Workers** for the API and admin backend

The result is a CMS that's effectively free to run at low-to-moderate traffic, globally distributed, and zero-maintenance. No VMs. No cron jobs. No infrastructure.

---

## Features

- **Custom content types** — define schemas with any combination of field types
- **Globals** — mark any content type "single entry" to get one always-published set of values (contact details, social links, SEO defaults) instead of a list
- **11 field types** — text, rich text, email, phone, image (single or multiple), number, datetime, boolean, relation (one-to-many), select, color
- **Draft / Published / Scheduled** workflow — published entries track unpublished edits separately so you can stage changes without taking content offline
- **Asset management** — upload images (JPEG, PNG, WebP, GIF, AVIF, SVG), PDFs, and video (MP4, WebM) to R2; alt text editable inline from the entry editor; magic-byte validation prevents MIME spoofing
- **Public assets** — mark a file public to serve it at a permanent, unsigned URL instead of an expiring one, for PDF forms and download links visitors keep
- **Webhooks** — HMAC-SHA256 signed payloads, automatic retry, delivery logs, test-fire button
- **User management** — admin and editor roles with JWT auth and refresh tokens
- **Preview URLs** — generate a signed, time-limited link to preview a draft entry on your frontend before publishing
- **Export** — download any content type as JSON or CSV
- **Audit log** — full activity history (who changed what, when) with 30-day retention
- **Branding** — configurable site name, logo, accent color, and favicon
- **Scheduled publishing** — set a future publish date; a Cloudflare Cron Trigger handles automatic promotion to published
- **Drag-and-drop entry ordering** — control the sort order of entries per content type

---

## Webstudio Integration

Etch was built as a Cloudflare-native backend for [Webstudio](https://webstudio.is/) — a visual web builder designed to connect to any headless CMS. Use Webstudio's Resources panel to fetch content from Etch's public API and bind it directly to components and dynamic pages.

### Connect a collection

In Webstudio, create a Resource pointing to your Etch Worker:

```
GET https://your-worker.your-subdomain.workers.dev/api/public/blog-posts
```

The response is clean, paginated JSON:

```json
{
  "data": [
    {
      "id": "01j...",
      "slug": "my-first-post",
      "status": "published",
      "published_at": "2025-06-01T12:00:00.000Z",
      "fields": {
        "title": "My First Post",
        "body": "<p>Hello world</p>",
        "cover_image": {
          "url": "https://your-worker.workers.dev/r2/abc123.jpg",
          "alt_text": "A scenic mountain photo"
        },
        "category": "news",
        "featured": true
      }
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 100,
    "pages": 1,
    "has_next": false
  }
}
```

Bind the `data` array to a Webstudio Collection component, then map each field to elements via bindings.

**Query params:**

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | `100` | Items per page (max `1000`, or `all` for up to 10,000) |
| `page` | `1` | Page number |
| `sort_by` | `sort_order` | Sort column: `sort_order`, `created_at`, `updated_at`, `published_at`, or any field slug |
| `sort_dir` | `asc` | Sort direction: `asc` or `desc` |
| `date_field` | — | Slug of a `datetime` field to filter by date |
| `date_filter` | — | `future` returns entries where `date_field` is after now; `past` returns entries where it is before now. Requires `date_field`. |
| `filter[slug]` | — | Filter by field value (equality shorthand). See field filtering below. |
| `filter[slug][op]` | — | Filter by field value with an explicit operator. See field filtering below. |

When `date_filter` is active and no `sort_by` is given, results are automatically sorted by `date_field` — ascending for `future` (soonest first), descending for `past` (most recent first).

**Date filter examples:**

```
# Upcoming events, soonest first
GET /api/public/events?date_field=event_date&date_filter=future

# Past events, most recent first
GET /api/public/events?date_field=event_date&date_filter=past

# Upcoming events, sorted alphabetically instead
GET /api/public/events?date_field=event_date&date_filter=future&sort_by=name&sort_dir=asc
```

**Field filtering:**

Use `filter[slug]=value` for equality, or `filter[slug][op]=value` for other operators. Multiple filters are ANDed together. Unknown field slugs are silently ignored.

| Operator | Description | Applicable field types |
|----------|-------------|------------------------|
| `eq` (default) | Equals | All |
| `not` | Not equal (includes entries where field is empty) | All |
| `empty` | No value set (null, empty string, or empty array) | All |
| `notempty` | Has any value | All |
| `contains` | Value contains substring (case-insensitive) | text, rich_text, email, phone, select |
| `in` | Value is one of a comma-separated list | text, select |
| `gt` / `gte` | Greater than / greater than or equal | number, datetime |
| `lt` / `lte` | Less than / less than or equal | number, datetime |

For `datetime` fields, `gt`/`gte`/`lt`/`lte` values should be ISO 8601 strings (e.g. `2026-01-01T00:00:00Z`).

```
# Events with no photos uploaded yet
GET /api/public/events?filter[event_photos][empty]=1

# Upcoming events with no photos (combining date filter + field filter)
GET /api/public/events?date_field=event_date&date_filter=future&filter[event_photos][empty]=1

# Posts in a specific category
GET /api/public/posts?filter[category]=news

# Posts in any of several categories
GET /api/public/posts?filter[category][in]=news,updates,announcements

# Products in a price range
GET /api/public/products?filter[price][gte]=50&filter[price][lte]=200
```

### Fetch a single entry

```
GET https://your-worker.workers.dev/api/public/blog-posts/my-first-post
```

Accepts either a slug or an entry UUID. Use this for individual article pages or detail routes in Webstudio.

### Fetch a random entry

```
GET https://your-worker.workers.dev/api/public/blog-posts/random
```

Useful for "featured post" or "quote of the day" components.

### Fetch a global

Content types marked **Single entry** in the admin UI hold exactly one set of values. Fetch them with `/first`, which returns a bare object rather than a paginated list:

```
GET https://your-worker.workers.dev/api/public/site-contact/first
```

```json
{
  "data": {
    "id": "01j...",
    "fields": {
      "email": "hello@example.com",
      "phone": "+1 555 0100",
      "address": "123 Main St"
    }
  }
}
```

Bind this to a Webstudio Resource once and reference it from your header, footer, and contact page. Globals are provisioned already published, so this endpoint never 404s once the content type exists — an unfilled global returns `null` fields rather than an error.

Like any published entry, edits to a global are saved as a draft and only reach the public API when you click **Publish Changes**. Until then the endpoint keeps returning the previous values, which for a newly created global means `null` fields. The global's editor shows a banner while changes are waiting to be published.

Create as many globals as you have distinct concerns (Contact Info, Social Links, SEO Defaults, Footer) — separate types keep each payload small and let you grant editors access per-global. `GET /api/public/:typeSlug` still works on a global and returns a one-item list, so nothing breaks if you convert an existing single-entry collection.

### Trigger a Webstudio rebuild on publish

Add your Webstudio site's deploy hook URL in Etch's Webhooks section. Etch will POST a signed payload whenever content changes:

| Event | When |
|-------|------|
| `entry.published` | An entry goes from draft/scheduled → published |
| `entry.updated` | Changes on a published entry are pushed live |
| `entry.unpublished` | An entry is moved back to draft |
| `entry.deleted` | An entry is deleted |

The webhook payload includes an `X-Webhook-Signature` header (`sha256=<hmac>`) signed with your webhook secret, so you can verify the request is genuine before triggering a rebuild.

### Asset URLs: signed vs. public

The **Image / Asset** field type holds any file in your library — images, PDFs, video. Every asset reference comes back as `{ url, alt_text }`, but there are two kinds of `url`:

| | URL shape | Lifetime | Use for |
|---|---|---|---|
| Default | `/r2/abc.pdf?expires=…&sig=…` | 1 hour | Images your frontend re-fetches on every render |
| **Public** | `/r2/abc.pdf` | Permanent | Anything a visitor keeps |

Signed URLs are the safe default, but they expire. That's invisible for an `<img>` on a server-rendered page and fatal for anything that outlives the API response — a PDF form someone bookmarks or emails, a download link on a statically-built page, an `og:image` a scraper fetches tomorrow.

Toggle **Public link** on the asset (in the entry editor beside the file, or in the Assets library) and Etch stops signing it — the public API returns the bare `/r2/` path, and the `/r2/` route serves it to anyone. Use it for files you'd be comfortable handing anyone the link to; leave it off for anything gated.

Turning the toggle on reveals the permanent URL right below it, with buttons to copy it or open it in a new tab — that's the link to paste into a Webstudio button, an email, or a nav item. If you've configured a [files subdomain](#7-optional-a-files-subdomain-for-public-assets), the link is built on that hostname.

> **Copying a private asset's URL.** The Assets library's copy button works on private assets too, but the URL it gives you only resolves for a signed-in admin — it will load in your browser and 401 for your visitors. Etch warns you when you copy one. Turn on public access before using a link anywhere public.

### Alt text

Alt text lives on the **asset**, not on the field, so it's written once and reused everywhere that file appears. Edit it from either place:

- The entry editor, in the box beneath any image you've selected
- The Assets library, via the asset's detail controls

Because it's stored per file, changing alt text in one entry changes it in every entry using that same image. If two entries need different alt text for the same picture, upload it twice.

### Rich text fields

Rich text is returned as HTML. Etch automatically:

- Rewrites internal `/r2/...` image paths to full absolute URLs so images work in any context (these are always signed, even if the asset is marked public)
- Adds `id` attributes to `<h1>` and `<h2>` headings for anchor links

In Webstudio, render rich text using a **Content Embed** component.

> **Security: sanitize before rendering.** Rich text fields may contain arbitrary HTML if the **HTML Blocks** extension is enabled for that field. Always sanitize the HTML before rendering it in your frontend — never pass it directly to `dangerouslySetInnerHTML` or `innerHTML` without sanitization. [DOMPurify](https://github.com/cure53/DOMPurify) is the standard tool for this:
>
> ```js
> import DOMPurify from 'dompurify';
> const clean = DOMPurify.sanitize(entry.fields.body);
> ```
>
> Even without HTML Blocks enabled, sanitization is a good default practice for any user-generated HTML.

### Relation fields

Relation fields are fully resolved inline — no second request needed:

```json
{
  "fields": {
    "author": {
      "id": "01j...",
      "status": "published",
      "published_at": "2025-01-15T10:00:00.000Z",
      "fields": {
        "name": "Jane Smith",
        "avatar": {
          "url": "https://your-worker.workers.dev/r2/jane.jpg",
          "alt_text": "Jane Smith"
        }
      }
    }
  }
}
```

### Preview draft content in Webstudio

Generate a preview token from the entry's action menu in the Etch admin. Pass the token to your Webstudio page via a URL parameter:

```
GET /api/public/blog-posts/my-draft-post?preview=<token>
```

The token is valid for 7 days and bypasses the published-only filter, letting you share a preview link with clients before content goes live. Returns the draft version if unpublished changes exist.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers ([Hono](https://hono.dev/)) |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Static assets | Cloudflare Workers KV |
| Admin UI | React 19 + Vite + Tailwind CSS v4 + shadcn/ui |
| Rich text editor | Tiptap v2 |
| Auth | JWT (HS256) with refresh tokens |

---

## Deployment

### Prerequisites

- A [Cloudflare account](https://cloudflare.com) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and authenticated (`wrangler login`)

### 1. Clone and install

```bash
git clone https://github.com/birchkey/etch-cms
cd etch-cms
npm install
cd client && npm install && cd ..
```

### 2. Configure Wrangler

```bash
cp wrangler.example.toml wrangler.toml
```

Open `wrangler.toml` and replace the placeholder values — `your-worker-name`, `your-d1-database-name`, `your-r2-bucket-name`, and `your-d1-database-id` — with your own names. Choose your database and bucket names now (you'll create the actual resources in the next step), then come back to fill in the `database_id` once Cloudflare generates it.

### 3. Create Cloudflare resources

```bash
# Create the D1 database
wrangler d1 create your-d1-database-name

# Create the R2 bucket
wrangler r2 bucket create your-r2-bucket-name
```

Copy the `database_id` from the D1 output and update the `database_id` field in `wrangler.toml`. Set `database_name` and `bucket_name` to match the names you chose above.

### 4. Run database migrations

```bash
npm run db:migrate:remote
```

> The `db:*` scripts address the database through its `DB` **binding**, not its name, so they need no editing after you rename things in `wrangler.toml` — Wrangler resolves the binding to `database_id` itself.
>
> `npm run db:migrate` (no `:remote`) applies migrations to the local SQLite file used by `wrangler dev` instead. Always use `db:migrate:remote` for your deployed instance.

### 5. Configure secrets

**For local development**, copy the example env file, then use the included script to generate and write the password hash directly to `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
node scripts/hash-password.mjs yourpassword
```

The script writes `ADMIN_PASSWORD_HASH` to `.dev.vars` automatically and prints the value. Wrangler loads `.dev.vars` during `wrangler dev`; it's already in `.gitignore`, so it won't be committed.

**For production**, set secrets via Wrangler:

```bash
# Admin username
wrangler secret put ADMIN_USERNAME

# Admin password hash — --print outputs the hash without touching .dev.vars; paste it at the prompt:
node scripts/hash-password.mjs --print yourpassword
wrangler secret put ADMIN_PASSWORD_HASH

# JWT signing secret
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
wrangler secret put JWT_SECRET

# Optional: require a key for the public API (sent as Authorization: Bearer <key>)
wrangler secret put PUBLIC_API_KEY
```

### 6. Build the client and deploy

```bash
cd client && npm run build && cd ..
wrangler deploy
```

Your CMS will be live at `https://etch-cms.YOUR_SUBDOMAIN.workers.dev`.

### 7. Optional: a files subdomain for public assets

Public assets are served from whatever hostname runs the Worker, which means a PDF link on a client's site reads `https://your-cms-host/r2/abc.pdf`. You can serve them from a branded hostname instead — `files.example.org` — so the links you hand out are stable and on-brand, and so you could move to different storage later without breaking URLs already in the wild.

**A plain CNAME will not work.** Pointing `files.example.org` at your Worker's hostname resolves to Cloudflare's edge, but Cloudflare routes by hostname and finds nothing registered for that name — you get **Error 1014 (CNAME Cross-User Banned)** if the zone is in another account, or a resolution loop if it's in yours. The hostname has to be attached to the Worker:

```toml
# wrangler.toml — for a zone in your own Cloudflare account
routes = [
  { pattern = "cms.example.org",   custom_domain = true },
  { pattern = "files.example.org", custom_domain = true },
]

[vars]
ASSETS_HOSTNAME = "files.example.org"
```

For a domain your customer controls, use **Cloudflare for SaaS** custom hostnames rather than `routes` — they CNAME to a fallback origin you own and you register the hostname via API. It's a paid add-on per hostname.

`ASSETS_HOSTNAME` does two things:

- **Locks the files hostname down to files.** Every route in this Worker answers on every hostname attached to it, so without this the admin UI, the login page and the full API would all be live on your client's domain. When set, that hostname serves `/r2/*` and 404s everything else.
- **Emits asset URLs on it.** The public API normally builds asset URLs from whichever host served the request; with this set they're always `https://files.example.org/r2/...`. The admin's copy-link buttons follow suit.

Signed URLs are signed over the path only, not the host, so they validate on either hostname — switching this on doesn't invalidate anything already issued. But public asset URLs already published *will* change, so pick the hostname before you start handing links out and treat it as permanent.

### Local development

```bash
# Terminal 1 — Worker (port 8787)
npm run dev

# Terminal 2 — Vite dev server (port 5173, proxies /api to 8787)
cd client && npm run dev
```

Open `http://localhost:5173`.

### Pulling production data locally

To develop against real content, you can export the production D1 database and import it into your local environment:

```bash
npm run db:pull
```

That exports production to `./prod-backup.sql`, wipes the local D1 state, and imports the
export in its place. The export includes the full schema and data, so you don't need to
re-run migrations afterward. Pass a different path with `npm run db:pull -- ./other.sql`.

**Note:** Secrets (`ADMIN_PASSWORD_HASH`, `JWT_SECRET`, etc.) are stored as Wrangler secrets, not in the database, so the export contains no credentials. Your local login still uses the values in `.dev.vars`.

`prod-backup.sql` is gitignored — don't commit it, especially if your content includes user-submitted data.

### Database scripts

Every script below targets the database through the `DB` binding in `wrangler.toml`, so none
of them hardcode your database name or id — Wrangler looks those up itself.

| Script | What it does |
|--------|--------------|
| `npm run db:migrate` | Apply pending migrations to the **local** dev database |
| `npm run db:migrate:remote` | Apply pending migrations to **production** |
| `npm run db:migrate:list` | List migrations not yet applied to production |
| `npm run db:query -- "SELECT …"` | Run a one-off SQL statement locally |
| `npm run db:query:remote -- "SELECT …"` | Run a one-off SQL statement against production |
| `npm run db:export` | Dump production to `./prod-backup.sql` |
| `npm run db:pull` | Dump production and replace the local database with it |

---

## Public API Reference

All `/api/public/` endpoints are CORS-enabled for cross-origin use. They are unauthenticated by default. If the optional `PUBLIC_API_KEY` secret is set, every request must send it as `Authorization: Bearer <key>` (see [Configure secrets](#5-configure-secrets)).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/public/:typeSlug` | List published entries (paginated) |
| `GET` | `/api/public/:typeSlug/first` | Get the first published entry as a bare object — use this for globals |
| `GET` | `/api/public/:typeSlug/random` | Get one random published entry |
| `GET` | `/api/public/:typeSlug/:idOrSlug` | Get a single entry by UUID or slug |
| `GET` | `/api/public/:typeSlug/:slug?preview=<token>` | Get a draft entry via preview token |

---

## Admin API Reference

The admin UI authenticates with session cookies. For scripts, integrations and agents, create an **API token** under **API Tokens** in the sidebar and send it in the `Authorization` header:

```bash
curl https://your-worker.workers.dev/api/content-types \
  -H "Authorization: Bearer etch_…"
```

A token acts as the user who created it, with the same role and content-type permissions, checked on every request. Deleting the user or changing their permissions takes effect immediately. Tokens are shown once at creation, stored only as a hash, can be set to expire, and can be revoked by their owner or any admin. Changes made with a token are recorded in the activity log with the token's ID. A token can't create other tokens or change a password; those require signing in.

Editors can create and edit entries. Admins can additionally manage content types, users, webhooks, and settings.

```
POST   /api/auth/login
POST   /api/auth/refresh
DELETE /api/auth/logout
PATCH  /api/auth/password

GET    /api/content-types
POST   /api/content-types                          (admin)
GET    /api/content-types/:id
PUT    /api/content-types/:id                      (admin)
DELETE /api/content-types/:id                      (admin)
GET    /api/content-types/:typeId/singleton        (resolves/provisions a global's entry)
GET    /api/content-types/:typeId/entries
GET    /api/content-types/:typeId/entries/select
PATCH  /api/content-types/:typeId/entries/reorder  (admin)
GET    /api/content-types/:typeId/entries/export

GET    /api/entries/count
GET    /api/entries/attention
GET    /api/entries/recent
GET    /api/entries/upcoming
POST   /api/entries
GET    /api/entries/:id
PUT    /api/entries/:id
PATCH  /api/entries/:id/publish
PATCH  /api/entries/:id/unpublish
PATCH  /api/entries/:id/schedule
PATCH  /api/entries/:id/unschedule
POST   /api/entries/:id/duplicate
POST   /api/entries/:id/preview-token
DELETE /api/entries/:id

GET    /api/assets
POST   /api/assets
POST   /api/assets/register
PATCH  /api/assets/:id
DELETE /api/assets/:id

GET    /api/users                                  (admin)
POST   /api/users                                  (admin)
PATCH  /api/users/:id                              (admin)
PATCH  /api/users/:id/password                     (admin)
DELETE /api/users/:id                              (admin)

GET    /api/settings
PUT    /api/settings                               (admin)

GET    /api/webhooks                               (admin)
POST   /api/webhooks                               (admin)
PATCH  /api/webhooks/:id                           (admin)
DELETE /api/webhooks/:id                           (admin)
GET    /api/webhooks/:id/deliveries                (admin)
POST   /api/webhooks/:id/test                      (admin)

GET    /api/audit-logs                             (admin)

GET    /api/tokens                                 (your tokens; admins see all)
POST   /api/tokens                                 (signed-in session only)
DELETE /api/tokens/:id                             (owner or admin)
```

The preview endpoint uses its own token auth (not Bearer) and is CORS-enabled:

```
GET    /api/preview/:token
```

---

## Importing Content

How to load content through the admin API, for example when migrating from another site. Authenticate with an [API token](#admin-api-reference). Creating content types needs an admin's token; creating entries and uploading assets works with an editor's.

### Order of operations

1. **Read the schema.** `GET /api/content-types` lists types; `GET /api/content-types/:id` returns each field's `slug`, `type`, `required`, `multiple`, `select_options`, `relation_content_type_id` and `repeater_subfields`. Entry values are keyed by field `slug`.
2. **Create content types** if they don't exist yet (admin). Create types that others relate to first, since a relation field needs the target type's ID.
3. **Upload assets** and keep a map from old URL to new path (see [Assets](#assets)).
4. **Create entries.** Create entries that others relate to first, and keep a map from old ID to new ID so relation fields can be filled in.
5. **Publish.** Entries are always created as drafts; publish each one separately.

### Create a content type (admin)

```http
POST /api/content-types
{
  "name": "Blog Posts",
  "slug": "blog-posts",
  "fields": [
    { "name": "Title", "type": "text", "required": true },
    { "name": "Body", "type": "rich_text" },
    { "name": "Cover", "type": "image" },
    { "name": "Category", "type": "select", "select_options": "[\"News\",\"Guides\"]" },
    { "name": "Author", "type": "relation", "relation_content_type_id": "<authors type id>", "relation_cardinality": "one" }
  ]
}
```

Field slugs default to the name in `snake_case` (`"Cover Image"` → `cover_image`). Set `"multiple": true` on `image` or `select` fields that hold several values. `select_options` and `repeater_subfields` are **JSON-encoded strings**, not arrays. Add `"is_singleton": true` for a global. Other per-field options (`min_length`, `max_length`, `min_value`, `max_value`, `pattern`, `phone_format`, `helper_text`) match the field editor.

### Create and publish an entry

```http
POST /api/entries
{
  "content_type_id": "<type id>",
  "slug": "my-first-post",
  "fields": {
    "title": "My First Post",
    "body": "<p>Hello <strong>world</strong></p><img src=\"/r2/abc123.jpg\">",
    "cover": "/r2/abc123.jpg",
    "category": "News",
    "author": "<author entry id>"
  }
}
```

The response is the created entry; use its `id` to publish:

```http
PATCH /api/entries/:id/publish
```

- `slug` is optional and is normalised to lowercase-with-hyphens. A slug already used in that content type returns **409**, which makes it a natural key for re-runnable imports: look an entry up first with `GET /api/content-types/:typeId/entries?q=<slug>` (a substring search over slugs and field values, so compare `slug` exactly; paginated with `page` and `limit`, up to 1000 per page) and update it with `PUT /api/entries/:id` (same body, without `content_type_id`) instead of creating a duplicate.
- **Field values aren't validated when an entry is created or updated.** Unknown field slugs are silently dropped, and required fields, lengths, ranges and patterns are only checked when publishing. A publish that fails returns **400** with a `fieldErrors` object keyed by field slug. Publishing an entry that links to unpublished entries succeeds but returns a `warnings` array, and those links are left out of the public API until the related entries are published.
- **Globals** can't be created with `POST /api/entries` (it returns 409). `GET /api/content-types/:typeId/singleton` returns the global's one entry; fill it with `PUT /api/entries/:id`, then publish.
- To keep an entry unpublished until a date, use `PATCH /api/entries/:id/schedule` with `{ "scheduled_at": <Unix ms> }` instead of publishing.

### Field values to send

Values you **write** are not always in the shape the public API **returns** (see [Field Types](#field-types)). Send:

| Type | Send | Example |
|------|------|---------|
| `text`, `email`, `phone` | string | `"hello@example.com"` |
| `rich_text` | HTML string; reference uploaded images as `/r2/<filename>` | `"<p>Hi</p><img src=\"/r2/abc123.jpg\">"` |
| `image` | path `/r2/<filename>`; array of paths when `multiple` | `"/r2/abc123.jpg"` |
| `number` | number | `42` |
| `boolean` | boolean | `true` |
| `datetime` | `{ datetime, timezone }`, wall-clock time without seconds or offset, plus an IANA timezone | `{ "datetime": "2025-06-01T09:30", "timezone": "America/Chicago" }` |
| `select` | one of the field's options; array when `multiple` | `"News"` |
| `relation` | entry ID (`one`) or array of entry IDs (`many`) | `"7c9e…"` |
| `color` | hex string | `"#ff5733"` |
| `icon` | Font Awesome classes, `fa-<style> fa-<name>` | `"fa-solid fa-house"` |
| `repeater` | array of objects keyed by subfield slug, each with a unique `_id` | `[{ "_id": "<uuid>", "label": "Docs", "link": "https://…" }]` |

Send `null` to clear a field. On `PUT`, fields you leave out keep their current value.

### Assets

Upload a file with a multipart request. The declared type must match the file's content, and the size limit is set in **Settings** (50 MB by default):

```bash
curl https://your-worker.workers.dev/api/assets \
  -H "Authorization: Bearer etch_…" \
  -F "file=@photo.jpg;type=image/jpeg" \
  -F "alt_text=Front of the building"
```

Accepted types are JPEG, PNG, GIF, WebP, AVIF, SVG, ICO, PDF, MP4 and WebM. The response includes the asset's `filename`; the value to put in an `image` field or a rich-text `src` is `/r2/<filename>`.

For a large library, copy the files into the R2 bucket under `assets/` first (with `wrangler r2 object put` or rclone), then add each one to the asset library with `POST /api/assets/register` and `{ "r2_key": "assets/<filename>", "alt_text": "…" }`. That avoids sending every file through the Worker.

---

## Field Types

What the public API returns for each field type. To write values through the admin API, see [Field values to send](#field-values-to-send). An empty field is `null`.

| Type | API value | Notes |
|------|-----------|-------|
| `text` | `string` | Plain text |
| `rich_text` | `string` (HTML) | Headings get auto-generated `id` attributes; image URLs are absolute (and signed, like `image`) |
| `image` | `{ url, alt_text }` or array | Any asset — image, PDF, video. Labelled **Image / Asset** in the editor. `url` is signed and expires in an hour unless the asset is marked public. An array when `multiple: true` |
| `number` | `number` | |
| `datetime` | `{ iso, long, date, time, timestamp, timezone }` | `iso` is the wall-clock time as entered, without an offset (`"2025-06-01T09:30"`). `long`, `date` and `time` are display strings (`"June 1, 2025 at 9:30 AM"`, `"June 1, 2025"`, `"9:30 AM"`). `timestamp` is Unix seconds, adjusted for `timezone` (an IANA name, or `null` if none was stored) |
| `boolean` | `boolean` | |
| `relation` | entry object or array | `{ id, status, published_at, created_at, updated_at, fields }`, resolved inline. An array when the cardinality is `many`. Only published related entries are included. Resolved one level deep: relation fields inside a related entry are returned as raw entry IDs |
| `select` | `string` or array | One value from a defined set of options; an array when `multiple: true` |
| `email` | `string` | Email address |
| `phone` | `string` | Phone number; a sibling `{slug}_digits` key with only numeric characters is also included |
| `color` | `string` | Hex color value (e.g. `#ff5733`) |
| `icon` | `{ class, glyph }` | `class` is the Font Awesome class string (`"fa-solid fa-house"`); `glyph` is the icon's Unicode character for use with the Font Awesome font, or `null` if unknown |
| `repeater` | array of objects | One object per item: `_id` plus a key per subfield slug. Subfield values use the formats above (an `image` subfield returns `{ url, alt_text }`, a `datetime` subfield the datetime object, and so on) |

---

## License

MIT
