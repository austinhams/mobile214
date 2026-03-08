# Mobile 214

A simple app that can serve multiple people.  It allows responders to create an ICS-214 via their mobile device, and export to PDF.

## Session Secret Generation

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d
```