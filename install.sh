#!/bin/bash
# Install grokbar for the current user. Safe to run again after `git pull`.
set -euo pipefail

ROOT=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
PLUGIN="$CONFIG_DIR/omarchy/plugins/heymitch.grokbar"
HYPR="$CONFIG_DIR/hypr"
THEME="$HOME/.local/state/omarchy/current/theme"
UNITS="$CONFIG_DIR/systemd/user"

say() { printf '  %s\n' "$*"; }
fail() { printf 'grokbar: %s\n' "$*" >&2; exit 1; }

for cmd in omarchy hyprctl jq node notify-send; do
  command -v "$cmd" >/dev/null || fail "needs $cmd"
done
(( $(node -p 'process.versions.node.split(".")[0]') >= 20 )) || fail "needs Node 20 or later"

mkdir -p "$CONFIG_DIR/grokbar"
[[ -f $CONFIG_DIR/grokbar/config.json ]] || cp "$ROOT/config.example.json" "$CONFIG_DIR/grokbar/config.json"
PROFILE="$ROOT/profiles/$(jq -r '.profile // "grok-bot"' "$CONFIG_DIR/grokbar/config.json").json"
[[ -f $PROFILE ]] || fail "no profile at $PROFILE"
APP=$(jq -r .command "$PROFILE")
[[ -x $APP ]] || fail "$(jq -r .name "$PROFILE") isn't installed ($APP not found)"

echo "Installing grokbar"

# Bar icon (this folder is the Omarchy plugin) and the command.
mkdir -p "$(dirname "$PLUGIN")" "$HOME/.local/bin"
ln -sfn "$ROOT" "$PLUGIN"
ln -sf "$ROOT/bin/grokbar" "$HOME/.local/bin/grokbar"
say "bar plugin: $PLUGIN"
say "command:    ~/.local/bin/grokbar"

# Window rule and Super+B. Copied, so you can change the key.
if [[ ! -f $HYPR/grokbar.lua ]]; then
  cp "$ROOT/hypr/grokbar.lua" "$HYPR/grokbar.lua"
fi
if ! grep -q 'require("hypr.grokbar")' "$HYPR/hyprland.lua"; then
  if hyprctl binds -j | jq -e '.[] | select(.modmask == 64 and .key == "B")' >/dev/null; then
    say "warning: Super+B is already bound; edit $HYPR/grokbar.lua to pick another key"
  fi
  cp "$HYPR/hyprland.lua" "$HYPR/hyprland.lua.bak-grokbar-$(date +%s)"
  printf '\n-- grokbar: Grok Bot drop-down and Super+B.\nrequire("hypr.grokbar")\n' >>"$HYPR/hyprland.lua"
fi
say "Hyprland:   $HYPR/grokbar.lua (Super+B)"

# Hint colors follow the Omarchy theme. Render once now; Omarchy re-renders
# the template on every theme change.
mkdir -p "$CONFIG_DIR/omarchy/themed"
ln -sf "$ROOT/themed/grokbar.css.tpl" "$CONFIG_DIR/omarchy/themed/grokbar.css.tpl"
if [[ -f $THEME/colors.toml ]]; then
  cp "$ROOT/themed/grokbar.css.tpl" "$THEME/grokbar.css"
  while IFS=$'\t' read -r key value; do
    sed -i "s|{{ $key }}|$value|g" "$THEME/grokbar.css"
  done < <(omarchy-theme-color --file "$THEME/colors.toml" --all)
fi
say "theme:      hint colors from your Omarchy theme"

# App menu entry starts the app through grokbar, so hints load.
DESKTOP=$(jq -r '.desktopFile // empty' "$PROFILE")
if [[ -n $DESKTOP && -f /usr/share/applications/$DESKTOP ]]; then
  mkdir -p "$HOME/.local/share/applications"
  sed "s|^Exec=[^ ]*|Exec=$HOME/.local/bin/grokbar launch|; s|^TryExec=.*|TryExec=$HOME/.local/bin/grokbar|" \
    "/usr/share/applications/$DESKTOP" >"$HOME/.local/share/applications/$DESKTOP"
  say "app menu:   starts through grokbar"
fi

# Update watcher: when the app's files change, offer a restart and recheck.
WATCH=$(jq -r '.watch // empty' "$PROFILE")
if [[ -n $WATCH ]]; then
  mkdir -p "$UNITS"
  cat >"$UNITS/grokbar-update.path" <<EOF
[Unit]
Description=grokbar: watch for $(jq -r .name "$PROFILE") updates

[Path]
PathChanged=$WATCH

[Install]
WantedBy=default.target
EOF
  cat >"$UNITS/grokbar-update.service" <<EOF
[Unit]
Description=grokbar: offer a restart and recheck keyboard hints after an update

[Service]
Type=oneshot
ExecStart=$HOME/.local/bin/grokbar updated
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now grokbar-update.path >/dev/null 2>&1
  say "updates:    watching $WATCH"
fi

# Put the icon on the right of the bar, once.
if ! jq -e '[.bar.layout[][]? | .id] | index("heymitch.grokbar")' "$CONFIG_DIR/omarchy/shell.json" >/dev/null 2>&1; then
  omarchy bar put heymitch.grokbar --section right >/dev/null 2>&1 || say "add the grokbar widget to your bar from the bar settings"
fi

hyprctl reload >/dev/null
echo "Done. Press Super+B."
if pgrep -f "$APP" >/dev/null && [[ ! -S ${XDG_RUNTIME_DIR:-/tmp}/grokbar.sock ]]; then
  echo "Quit $(jq -r .name "$PROFILE") and press Super+B to start it with keyboard hints."
fi
