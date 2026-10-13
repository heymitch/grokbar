#!/bin/bash
# Remove grokbar. Leaves ~/.config/grokbar/config.json and the app itself alone.
set -uo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
HYPR="$CONFIG_DIR/hypr"

systemctl --user disable --now grokbar-update.path >/dev/null 2>&1
rm -f "$CONFIG_DIR/systemd/user/grokbar-update.path" "$CONFIG_DIR/systemd/user/grokbar-update.service"
systemctl --user daemon-reload

if [[ -f $HYPR/hyprland.lua ]]; then
  cp "$HYPR/hyprland.lua" "$HYPR/hyprland.lua.bak-grokbar-$(date +%s)"
  sed -i '/^-- grokbar: Grok Bot drop-down and Super+B\.$/d; /^require("hypr\.grokbar")$/d' "$HYPR/hyprland.lua"
fi
rm -f "$HYPR/grokbar.lua"

for file in "$HOME"/.local/share/applications/*.desktop; do
  grep -q "/.local/bin/grokbar launch" "$file" 2>/dev/null && rm -f "$file"
done

jq '.bar.layout |= with_entries(.value |= map(select(.id != "heymitch.grokbar")))' "$CONFIG_DIR/omarchy/shell.json" \
  >"$CONFIG_DIR/omarchy/shell.json.tmp" 2>/dev/null && mv "$CONFIG_DIR/omarchy/shell.json.tmp" "$CONFIG_DIR/omarchy/shell.json"
rm -f "$CONFIG_DIR/omarchy/plugins/heymitch.grokbar" "$CONFIG_DIR/omarchy/themed/grokbar.css.tpl" \
  "$HOME/.local/state/omarchy/current/theme/grokbar.css" "$HOME/.local/bin/grokbar"
rm -rf "$HOME/.local/state/grokbar"

hyprctl reload >/dev/null 2>&1
echo "grokbar removed. Restart the app to drop the keyboard hints."
