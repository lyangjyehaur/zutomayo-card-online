def required_string($value; $message):
  if ($value | type) == "string" and ($value | length) > 0 then $value else error($message) end;

def sanitized_database_url($value):
  if $value == "" then "" else "redacted-nonempty-database-url" end;

def sanitized_redis_url($service; $value):
  if $service == "migrate" then
    ""
  elif ($value | type) == "string" and ($value | startswith("rediss://")) then
    "rediss://redacted:redacted@redacted.invalid:6380"
  else
    "redis://redacted:redacted@redacted.invalid:6379"
  end;

def role_passwords:
  [
    "PG_MIGRATION_PASSWORD",
    "PG_APP_PASSWORD",
    "PG_API_PASSWORD",
    "PG_GAME_PASSWORD",
    "PG_PLATFORM_PASSWORD",
    "PG_RETENTION_PASSWORD",
    "PG_MONITOR_PASSWORD",
    "PG_BACKUP_PASSWORD",
    "PG_WAL_PASSWORD",
    "PG_WAL_OPERATOR_PASSWORD"
  ];

def api_owned_secrets:
  [
    "ADMIN_TOTP_ENCRYPTION_KEY",
    "ACCOUNT_EMAIL_WEBHOOK_SECRET",
    "TURNSTILE_SECRET_KEY",
    "OAUTH_TOKEN_ENCRYPTION_KEY",
    "LOGTO_APP_SECRET",
    "LOGTO_M2M_APP_SECRET",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "DISCORD_OAUTH_CLIENT_SECRET",
    "CHAT_TRANSLATION_API_KEY",
    "IMGPROXY_KEY",
    "IMGPROXY_SALT"
  ];

def actual_service_name($root; $canonical):
  if ($root.services | has($canonical)) then $canonical
  elif $canonical == "platform" and ($root.services | has("platform-p1")) then "platform-p1"
  else error("rendered Compose is missing service " + $canonical)
  end;

def assert_no_non_own_role_password($root; $service; $own_password):
  actual_service_name($root; $service) as $actual
  | [
    role_passwords[] as $variable
    | select($variable != $own_password and ($root.services[$actual].environment | has($variable)))
    | $variable
  ] as $unexpected
  | if ($unexpected | length) == 0 then true
    else error($service + " must not receive non-own " + $unexpected[0])
    end;

def assert_api_secret_ownership($root):
  [
    ["migrate", "game", "platform"][] as $service
    | actual_service_name($root; $service) as $actual
    | api_owned_secrets[] as $variable
    | select($root.services[$actual].environment | has($variable))
    | { service: $service, variable: $variable }
  ] as $unexpected
  | if ($unexpected | length) == 0 then true
    else error($unexpected[0].service + " must not receive API-owned " + $unexpected[0].variable)
    end;

def assert_parallel_platform_parity($root):
  if ($root.services | has("platform-p2")) then
    $root.services["platform-p1"].environment as $p1
    | $root.services["platform-p2"].environment as $p2
    | if ($p1 | del(.PLATFORM_PUBLIC_ADDRESS)) != ($p2 | del(.PLATFORM_PUBLIC_ADDRESS)) then
        error("platform-p1 and platform-p2 must have identical runtime/security environments except PLATFORM_PUBLIC_ADDRESS")
      elif required_string($p1.PLATFORM_PUBLIC_ADDRESS; "platform-p1 PLATFORM_PUBLIC_ADDRESS is required")
        == required_string($p2.PLATFORM_PUBLIC_ADDRESS; "platform-p2 PLATFORM_PUBLIC_ADDRESS is required") then
        error("platform-p1 and platform-p2 must advertise different process addresses")
      else true
      end
  else true
  end;

def projected_service($root; $service; $role_user):
  actual_service_name($root; $service) as $actual
  | $root.services[$actual].environment as $environment
  | {
      environment: {
        PG_USER: required_string($environment.PG_USER; ($service + " PG_USER is required")),
        PG_PASSWORD: ("redacted-" + $service + "-password"),
        ($role_user): required_string($environment[$role_user]; ($service + " " + $role_user + " is required")),
        DATABASE_URL: sanitized_database_url($environment.DATABASE_URL),
        PGSSLMODE: ($environment.PGSSLMODE // ""),
        REDIS_URL: sanitized_redis_url($service; $environment.REDIS_URL)
      }
    };

. as $root
| ["migrate", "game", "api", "platform"] as $services
| actual_service_name($root; "platform") as $platform
| [
    assert_no_non_own_role_password($root; "migrate"; "PG_MIGRATION_PASSWORD"),
    assert_no_non_own_role_password($root; "game"; "PG_GAME_PASSWORD"),
    assert_no_non_own_role_password($root; "api"; "PG_API_PASSWORD"),
    assert_no_non_own_role_password($root; "platform"; "PG_PLATFORM_PASSWORD"),
    assert_api_secret_ownership($root),
    assert_parallel_platform_parity($root)
  ]
| [
    $services[] as $service
    | actual_service_name($root; $service) as $actual
    | required_string($root.services[$actual].environment.PG_PASSWORD; ($service + " PG_PASSWORD is required"))
  ] as $passwords
| if ($passwords | unique | length) != ($passwords | length) then
    error("rendered runtime and migration PostgreSQL passwords must be pairwise distinct")
  elif (
    $root.services.game.environment.JWT_SECRET != $root.services.api.environment.JWT_SECRET
    or $root.services[$platform].environment.JWT_SECRET != $root.services.api.environment.JWT_SECRET
  ) then
    error("JWT_SECRET must match across game, API, and platform")
  elif $root.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET != $root.services[$platform].environment.PLATFORM_SEAT_TOKEN_SECRET then
    error("PLATFORM_SEAT_TOKEN_SECRET must match across game and platform")
  elif (
    [
      $root.services.api.environment.JWT_SECRET,
      $root.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET,
      $root.services.api.environment.ADMIN_TOTP_ENCRYPTION_KEY,
      $root.services.api.environment.OAUTH_TOKEN_ENCRYPTION_KEY
    ]
    | any(. == null or . == "")
  ) then
    error("release security secrets must be non-empty")
  elif (
    [
      $root.services.api.environment.JWT_SECRET,
      $root.services.game.environment.PLATFORM_SEAT_TOKEN_SECRET,
      $root.services.api.environment.ADMIN_TOTP_ENCRYPTION_KEY,
      $root.services.api.environment.OAUTH_TOKEN_ENCRYPTION_KEY
    ]
    | unique
    | length
  ) != 4 then
    error("JWT, seat-token, admin TOTP, and OAuth token secrets must be pairwise distinct")
  else
    {
      services: {
        migrate: projected_service($root; "migrate"; "PG_MIGRATION_USER"),
        game: projected_service($root; "game"; "PG_GAME_USER"),
        api: projected_service($root; "api"; "PG_API_USER"),
        platform: projected_service($root; "platform"; "PG_PLATFORM_USER")
      }
    }
  end
