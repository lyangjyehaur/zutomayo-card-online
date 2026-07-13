# Synthetic Player Journey

`scripts/synthetic-probe.mjs` runs a short, disposable player journey:

1. Fetch the game homepage.
2. Check health and readiness for game, API, and platform.
3. Authenticate with a dedicated synthetic account (or an injected session cookie).
4. Create a two-seat room, join both seats, verify the room members, and leave both seats.

The probe never uses a real player account. Create a dedicated account with no
friends, decks, or administrative permissions, and give it only the access
needed for the login flow. The probe's guest seat is intentionally anonymous.

## Host installation

Install the service and timer, then create an environment file readable only by
root and the dedicated probe group:

```sh
sudo install -m 0644 ops/systemd/zutomayo-synthetic-probe.service /etc/systemd/system/
sudo install -m 0644 ops/systemd/zutomayo-synthetic-probe.timer /etc/systemd/system/
sudo install -d -o root -g zutomayo-synthetic -m 0750 /etc/zutomayo
sudo install -o root -g zutomayo-synthetic -m 0640 /dev/null /etc/zutomayo/synthetic.env
sudo systemctl daemon-reload
sudo systemctl enable --now zutomayo-synthetic-probe.timer
```

The environment file must contain either a short-lived `SYNTHETIC_SESSION_COOKIE`
or the dedicated account's `SYNTHETIC_EMAIL` and `SYNTHETIC_PASSWORD`. In
production the systemd unit sets `NODE_ENV=production` and
`SYNTHETIC_REQUIRED=true`, so the probe fails closed when credentials are absent.
The default metrics path is
`/var/lib/node_exporter/textfile_collector/zutomayo_synthetic.prom`.

Set `SYNTHETIC_GAME_URL`, `SYNTHETIC_API_URL`, and `SYNTHETIC_PLATFORM_URL`
when the services are not on localhost. Keep the probe timeout below the
one-minute schedule and inspect both the timer and the textfile metric:

```sh
systemctl list-timers zutomayo-synthetic-probe.timer
systemctl status zutomayo-synthetic-probe.service
cat /var/lib/node_exporter/textfile_collector/zutomayo_synthetic.prom
```

The textfile metric is scraped by the existing backup metrics exporter. Add a
notification rule for `zutomayo_synthetic_probe_success == 0` and for a stale
`zutomayo_synthetic_probe_last_run_unixtime_seconds` value in the deployment's
alerting configuration. A local run or a passing unit test does not prove that
Alertmanager delivered a page; that delivery still requires staging/game-day
verification.
