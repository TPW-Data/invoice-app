# Invoice Upload

A small mobile-first web app: photograph a paper invoice, the AI reads it, you check the fields and save. Every invoice is one row, and you can export all rows to Excel.

**Stack:** GitHub Pages (static front end) · Supabase (Auth, Postgres, Storage, Edge Function) · Claude API (reads the photo)

## Fields per invoice

Invoice number · Company name · OIB · Net 5% · VAT 5% · Net 13% · VAT 13% · Net 25% · VAT 25% · Gross total · Expense classification · Upload date

## Files

| File | Purpose |
|---|---|
| `index.html` | Mobile UI |
| `app.js` | Photo capture, form, validation (incl. OIB check digit), save, Excel export |
| `config.js` | Supabase URL / anon key and expense categories |
| `supabase/schema.sql` | Table, row-level security, private photo bucket |
| `supabase/functions/extract-invoice/index.ts` | Sends the photo to Claude and returns JSON |

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up", so only invited people can log in.
4. Authentication → Users → **Invite user** for each staff member.
5. Authentication → URL Configuration: set **Site URL** to your GitHub Pages address (e.g. `https://yourname.github.io/invoice-app/`).
6. Copy the Project URL and `anon` key (Project Settings → API) into `config.js`.

### 2. Edge Function (AI reading)
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ANTHROPIC_MODEL=claude-haiku-5-5   # cheapest model (default)
supabase functions deploy extract-invoice
```

### 3. GitHub Pages
1. Create a GitHub repo (e.g. `invoice-app`) and push these files.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
3. Open the Pages URL on your phone, enter your email, tap the link from the sign-in email, then use "Add to Home Screen".

## Daily use
1. Tap **Photograph / choose invoice**. The photo is read automatically.
2. Check the highlighted fields. Expense classification is suggested but you pick the final value.
3. Warnings show if the OIB fails its check digit or Net + VAT ≠ Gross. Fix them, then **Save**.
4. The accumulated Excel file (`exports/invoices.xlsx` in the storage bucket) is rewritten from the database after every save, one row per invoice.
5. **Export Excel** downloads the current workbook. **View photo** on any saved invoice opens its source photo.

Source photos are stored in the private `invoice-images` Storage bucket, which lives in your Supabase project next to the database. Each invoice row keeps the photo's path.

## Notes
- The AI can misread photos. Always check the values before saving; the warnings catch many errors but not all.
- Invoice photos are sent to the Claude API for reading. Check that this fits your data-handling rules.
- The VAT columns assume Croatian rates (5%, 13%, 25%). Net and VAT are stored per rate, so an invoice with several rates is still one row.
- Not included yet: editing or deleting saved invoices, invoice date, and per-user filtering. These are easy to add to `app.js` and `schema.sql`.
