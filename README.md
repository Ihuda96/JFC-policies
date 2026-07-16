# JFC Policies Platform

منصة إدارة واعتماد واستعراض السياسات والإجراءات لتجمع جدة الصحي الأول.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill the public Supabase browser values.

3. Run the app:

   ```bash
   npm run dev
   ```

## Supabase

The application expects the production schema to be deployed manually by running:

```text
supabase/DEPLOY_TO_SUPABASE.sql
```

See [docs/SUPABASE_MANUAL_DEPLOYMENT.md](docs/SUPABASE_MANUAL_DEPLOYMENT.md).
