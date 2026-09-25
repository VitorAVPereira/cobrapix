-- Separate release switch for manual financial activation. Without a row it
-- is disabled, so new manual activations stay closed until an administrator
-- releases them; pausing it never affects companies already active.
ALTER TYPE "PlatformIntegration" ADD VALUE 'FINANCIAL_MANUAL_ACTIVATION';
