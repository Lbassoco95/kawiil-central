-- Label definitions per user
CREATE TABLE IF NOT EXISTS email_user_labels (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, name)
);

ALTER TABLE email_user_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own labels" ON email_user_labels FOR ALL USING (auth.uid() = user_id);

-- Label assignments (email_message_id is the Microsoft Graph message ID)
CREATE TABLE IF NOT EXISTS email_label_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email_message_id text NOT NULL,
  label_id uuid REFERENCES email_user_labels(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, email_message_id, label_id)
);

ALTER TABLE email_label_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own assignments" ON email_label_assignments FOR ALL USING (auth.uid() = user_id);
