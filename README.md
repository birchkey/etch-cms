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

Turning the toggle on reveals the permanent URL right below it, with buttons to copy it or open it in a new tab — that's the link to paste into a Webstudio button, an email, or a nav item.

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
wrangler d1 migrations apply your-d1-database-name --remote
```

> Always pass `--remote` when targeting your deployed D1 instance. Without it, Wrangler applies changes to a local SQLite file only.

### 5. Configure secrets

**For local development**, copy the example env file, then use the included script to generate and write the password hash directly to `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
node scripts/hash-password.mjs yourpassword
```

The script writes `ADMIN_PASSWORD_HASH` to `.dev.vars` automatically and prints the value. Wrangler loads `.dev.vars` during `wrangler dev` — add it to `.gitignore`.

**For production**, set secrets via Wrangler:

```bash
# Admin username
wrangler secret put ADMIN_USERNAME

# Admin password hash — generate with the included script, then copy the printed hash value:
node scripts/hash-password.mjs yourpassword
wrangler secret put ADMIN_PASSWORD_HASH

# JWT signing secret
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
wrangler secret put JWT_SECRET
```

### 6. Build the client and deploy

```bash
cd client && npm run build && cd ..
wrangler deploy
```

Your CMS will be live at `https://etch-cms.YOUR_SUBDOMAIN.workers.dev`.

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
# Export production DB to a local SQL file
npx wrangler d1 export your-d1-database-name --remote --output=./prod-backup.sql

# Wipe the local DB and replace it with the production export
rm -rf .wrangler/state/v3/d1
npx wrangler d1 execute your-d1-database-name --local --file=./prod-backup.sql
```

The export includes the full schema and data. You don't need to re-run migrations afterward.

**Note:** Secrets (`ADMIN_PASSWORD_HASH`, `JWT_SECRET`, etc.) are stored as Wrangler secrets, not in the database, so the export contains no credentials. Your local login still uses the values in `.dev.vars`.

`prod-backup.sql` is gitignored — don't commit it, especially if your content includes user-submitted data.

---

## Public API Reference

All `/api/public/` endpoints are unauthenticated and CORS-enabled for cross-origin use.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/public/:typeSlug` | List published entries (paginated) |
| `GET` | `/api/public/:typeSlug/first` | Get the first published entry as a bare object — use this for globals |
| `GET` | `/api/public/:typeSlug/random` | Get one random published entry |
| `GET` | `/api/public/:typeSlug/:idOrSlug` | Get a single entry by UUID or slug |
| `GET` | `/api/public/:typeSlug/:slug?preview=<token>` | Get a draft entry via preview token |

---

## Admin API Reference

All `/api/` endpoints require a `Bearer <token>` in the `Authorization` header. Obtain a token via `POST /api/auth/login`.

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
```

The preview endpoint uses its own token auth (not Bearer) and is CORS-enabled:

```
GET    /api/preview/:token
```

---

## Field Types

| Type | API value | Notes |
|------|-----------|-------|
| `text` | `string` | Plain text |
| `rich_text` | `string` (HTML) | Headings get auto-generated `id` attributes; image paths are absolute |
| `image` | `{ url, alt_text }` or array | Any asset — image, PDF, video. Labelled **Image / Asset** in the editor. `url` is signed and expires in an hour unless the asset is marked public. Single or multiple when `multiple: true` |
| `number` | `number` | |
| `datetime` | `string` (ISO 8601) | |
| `boolean` | `boolean` | |
| `relation` | entry object or array | Resolved inline; only published related entries are included |
| `select` | `string` | One value from a defined set of options |
| `email` | `string` | Email address |
| `phone` | `string` | Phone number; a sibling `{slug}_digits` key with only numeric characters is also included |
| `color` | `string` | Hex color value (e.g. `#ff5733`) |

---

## License

MIT
