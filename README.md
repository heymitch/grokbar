# grokbar

Grok Bot as a drop-down under the [Omarchy](https://omarchy.org) bar, driven from the keyboard.

Press **Super+B** and Grok Bot slides down from the top of the screen under the right end of
your bar. Press it again and it slides back up. The app keeps running while it's hidden, so
it comes back instantly. A small icon in the bar does the same on click.

Inside the app, **Alt+F** puts a letter on every bot, button, link and text box. Type the
letter and grokbar clicks it. Letters come from each item's name (**S**earch, **N**ew chat,
**E**ngineer Bot) and stay the same every time, so you learn them once.

Unofficial and not affiliated with Cursor, SpaceXAI or xAI. Grok Bot is their product; grokbar
only moves its window and adds keyboard shortcuts on your machine.

## Keys

| Key | What it does |
|---|---|
| Super+B | Drop Grok Bot down, or slide it back up |
| Alt+F | Show letters on everything clickable; type one to click it, Esc to cancel |
| Alt+F, then 1–9 | Pick an answer when a bot asks a question with A/B/C choices |
| Alt+N | New chat |
| Alt+/ | Search |
| Alt+I | Back to the message box |
| Alt+1–9 | Open bots in sidebar order (pinned bots first) |

Most items get one letter. When single letters run out, the rest get two letters that start
with a rarely used letter (q, z, x, v by default), so they never clash with the single ones.
Answer choices in a conversation are numbered in their A/B/C order.

## What else it does

- **Widens to the left when a panel opens.** Conversation details and the bot's computer view
  open as a panel on the right. grokbar widens the window to the left by the panel's width, so
  the right edge stays under the bar, and shrinks it back when the panel closes. Resizing it
  yourself (Omarchy's Super+= and Super+-, or the mouse) also keeps the right edge in place,
  and grokbar remembers the new width. Delete `~/.local/state/grokbar/width` to go back to
  the width in your config.
- **Tiles when you want it to.** Omarchy's Super+T tiles the drop-down like any window; Super+B
  puts it away, and the next Super+B drops it down again.
- **Gets out of the way.** The drop-down slides back up when a window goes fullscreen, the
  screensaver starts or a monitor disconnects, so it never sits on top of them.
- **Matches your Omarchy theme.** The letters use your theme's accent, background and font, and
  switch with it when you change themes. No restart.
- **Tells you when Grok Bot loses your computer.** Grok Bot sometimes drops its connection to
  your own computer while chat keeps working, so bots report the computer as offline. grokbar
  checks every minute and, if the connection is down, offers **Restart now**, which brings it
  back.
- **Checks itself after every Grok Bot update.** When pacman updates Grok Bot, a notification
  offers **Restart now**. Every time Grok Bot starts, grokbar checks that it can still find the
  bots, New chat, Search and the message box, and warns you if an update moved them.

## What you need

- Omarchy with the Quickshell bar and Hyprland's Lua config (Omarchy 4 or later)
- Grok Bot for Linux, installed from the AUR package `grok-bot`
- Node 20 or later, `jq`, and `notify-send` (all part of a standard Omarchy install)

## Install

```bash
git clone https://github.com/heymitch/grokbar.git ~/.local/share/grokbar
~/.local/share/grokbar/install.sh
```

Then quit Grok Bot if it's running and press **Super+B**. Grok Bot needs to start through
grokbar for the keyboard hints to load; Super+B, the bar icon and the app menu all do that.

The installer:

- links this folder in as an Omarchy bar plugin and puts the icon on the right of your bar
- adds `~/.config/hypr/grokbar.lua` (window rule and Super+B) and one `require` line to
  `hyprland.lua`, after backing it up
- adds a theme template so the hint colors follow your theme
- points the Grok Bot app-menu entry at grokbar
- turns on a user systemd watcher for Grok Bot updates

It's safe to run again after `git pull`.

## Settings

`~/.config/grokbar/config.json` (created on install):

```json
{
  "profile": "grok-bot",
  "width": 760,
  "heightPercent": 80,
  "top": 36,
  "gap": 10,
  "hints": {
    "singles": "asdfghjklewruiotypnmcb",
    "prefixes": "qzxv"
  }
}
```

- `width`, `heightPercent`: the drop-down's size. Panels add to the width.
- `top`, `gap`: distance from the top of the screen and from the right edge.
- `hints.singles`: letters used for one-letter hints, most comfortable first. On Colemak, try
  `"arstneiodhwfpluygcbm"` with `"prefixes": "qjzxvk"`.
- `hints.prefixes`: letters that start two-letter hints. Keep them out of `singles`.

To change Super+B, edit `~/.config/hypr/grokbar.lua`. The bar icon is a ball with two eyes in
your bar colors; set its **Icon** setting to `app` to use Grok Bot's own icon instead.

## How it works, and why it's safe

grokbar starts Grok Bot with Chromium's `--remote-debugging-pipe`, a private channel between
grokbar and the app. **No network port is opened.** Opening the usual debugging port would let
any program on your computer control your logged-in Grok Bot; with a pipe, only the grokbar
process that started the app can talk to it.

Over that channel grokbar does four things, and nothing else:

1. adds the hint script (`lib/hints.js`) to Grok Bot's own window, never to web pages it opens
2. sends a real mouse click where a hint points, because some buttons only respond to real
   clicks
3. reads how wide open panels are, to resize the window
4. runs its self-check

It also checks, outside the app, that Grok Bot's helper process for your computer is running.

It never reads your messages or sends anything anywhere. Hints find buttons by their
accessibility labels and roles, not by Grok Bot's internal code, which is why updates rarely
break them.

`grokbar check`, `grokbar restart`, `grokbar preview` and `grokbar inspect` talk to the
running grokbar over a socket in `$XDG_RUNTIME_DIR` that only your user can open, and accept
only those fixed commands.

## Commands

```
grokbar toggle      drop Grok Bot down, or slide it back up (Super+B)
grokbar launch      start Grok Bot with keyboard hints
grokbar check       check the hints still find the bots and buttons
grokbar restart     close Grok Bot cleanly and start it again
grokbar preview     show the hints for 3 seconds
grokbar inspect     list open panels and anything past the right edge
```

## Other apps

Everything specific to Grok Bot lives in `profiles/grok-bot.json`: how to start it, its window
class, which buttons Alt+N, Alt+/ and Alt+I press, where the bot list and side panels are, and
which file to watch for updates, and which helper process to keep an eye on. A profile for another Electron app, such as Slack, is a new
JSON file plus `"profile": "slack"` in your config. `grokbar inspect` shows the panels and labels
you need.

## Is this allowed?

Read this before you install. grokbar doesn't change Grok Bot's files, bypass any limit or
access anyone else's data. It does add a script to your own running copy of the app, which is
how keyboard tools like Vimium work in a browser. Cursor's
[Terms of Service](https://cursor.com/terms-of-service) (§1.5) and
[Acceptable Use Policy](https://cursor.com/acceptable-use-policy) say not to modify the Service
or access it "through automated or non-human means, whether through a bot, script, or
otherwise". grokbar's clicks only happen when you press a key, but Cursor could still see it as
modifying their app. The [Grok Bot Terms](https://cursor.com/terms/grok-bot) say nothing about
it either way. Use it at your own risk; if that's a concern, use only the drop-down (it never
touches the app) by starting Grok Bot normally.

"Grok" and "Grok Bot" are trademarks of their owners and are used here only to say which app
grokbar works with.

## Uninstall

```bash
~/.local/share/grokbar/uninstall.sh
```

It removes everything the installer added and keeps your `config.json`.

## License

MIT
