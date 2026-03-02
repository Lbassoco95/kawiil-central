
-- Add column to track if user has accepted invitation / changed password
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invitation_accepted boolean NOT NULL DEFAULT true;

-- Set existing users who already confirmed as accepted
-- New invited users will be set to false when created via invite-user function
