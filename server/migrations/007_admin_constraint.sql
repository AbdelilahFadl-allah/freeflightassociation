CREATE UNIQUE INDEX IF NOT EXISTS only_one_special_admin
  ON administrators (role) WHERE role = 'special_admin';
