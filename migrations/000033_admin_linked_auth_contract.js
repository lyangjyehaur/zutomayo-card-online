/** Keep password/TOTP administrators and linked-account administrators as distinct authentication modes. */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addConstraint('admin_users', 'admin_users_auth_mode_check', {
    check: `(
      user_id IS NULL
      AND password_hash IS NOT NULL
      AND salt IS NOT NULL
    ) OR (
      user_id IS NOT NULL
      AND password_hash IS NULL
      AND salt IS NULL
    )`,
  });
};

export const down = (pgm) => {
  pgm.dropConstraint('admin_users', 'admin_users_auth_mode_check', { ifExists: true });
};
