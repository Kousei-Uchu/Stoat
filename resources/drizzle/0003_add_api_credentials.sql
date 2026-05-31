ALTER TABLE "user_settings"
ADD COLUMN IF NOT EXISTS "discord_client_id" varchar(255),
ADD COLUMN IF NOT EXISTS "spotify_client_id" varchar(255),
ADD COLUMN IF NOT EXISTS "spotify_client_secret" varchar(255);
