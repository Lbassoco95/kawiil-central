
-- Add onboarding_status column to profiles
ALTER TABLE public.profiles 
ADD COLUMN onboarding_status text NOT NULL DEFAULT 'invited';

-- Update existing users based on current invitation_accepted flag
UPDATE public.profiles 
SET onboarding_status = 'active' 
WHERE invitation_accepted = true;

UPDATE public.profiles 
SET onboarding_status = 'invited' 
WHERE invitation_accepted = false;
