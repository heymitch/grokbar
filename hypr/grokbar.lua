-- grokbar: Grok Bot drops down from under the right end of the bar.
-- Hidden, it waits on the special workspace "grokbar"; `grokbar toggle`
-- slides it down. Installed by grokbar's install.sh; change the key here.
local grokbar = os.getenv("HOME") .. "/.local/bin/grokbar"

o.window("^(grok-bot|Grok Bot)$", {
  float = true,
  workspace = "special:grokbar silent",
  tag = "-default-opacity",
  opacity = "1.0 override 1.0 override",
})

o.bind("SUPER + B", "Grok Bot", grokbar .. " toggle")
