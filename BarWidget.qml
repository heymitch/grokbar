import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// Bar icon for grokbar. Click (or Super+B) runs `grokbar toggle`.
BarWidget {
  id: root
  moduleName: "heymitch.grokbar"

  readonly property int face: Math.round(Style.bar.iconFont * 1.05)
  readonly property bool appIcon: setting("icon", "face") === "app"
  readonly property string command: String(Qt.resolvedUrl("bin/grokbar")).replace("file://", "")

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.face + 16
    tooltipText: "Grok Bot (Super+B)"
    onPressed: function() {
      if (root.bar) root.bar.run("'" + root.command + "' toggle")
    }

    Image {
      visible: root.appIcon
      anchors.centerIn: parent
      width: root.face + 2
      height: width
      source: root.appIcon ? Quickshell.iconPath("grok-bot", true) : ""
      sourceSize.width: width * 2
      sourceSize.height: height * 2
      smooth: true
    }

    Rectangle {
      id: ball
      visible: !root.appIcon
      anchors.centerIn: parent
      width: root.face
      height: root.face
      radius: width / 2
      color: root.bar ? root.bar.barForeground : Color.foreground

      Rectangle {
        x: ball.width * 0.36; y: ball.height * 0.34
        width: ball.width * 0.12; height: ball.height * 0.28
        radius: width / 2
        color: Color.background
      }
      Rectangle {
        x: ball.width * 0.58; y: ball.height * 0.34
        width: ball.width * 0.12; height: ball.height * 0.28
        radius: width / 2
        color: Color.background
      }
    }
  }
}
