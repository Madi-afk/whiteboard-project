import "./CursorLayer.css";

function getLaserPath(points) {
  const visiblePoints = points
    .filter(
      (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)
    )
    .filter((point, index, list) => {
      if (index === 0) return true;

      const previousPoint = list[index - 1];
      return Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) > 2;
    })
    .slice(-22);

  if (visiblePoints.length < 2) {
    return "";
  }

  const firstPoint = visiblePoints[0];
  let path = `M ${firstPoint.x} ${firstPoint.y}`;

  for (let index = 1; index < visiblePoints.length - 1; index += 1) {
    const currentPoint = visiblePoints[index];
    const nextPoint = visiblePoints[index + 1];
    const midX = (currentPoint.x + nextPoint.x) / 2;
    const midY = (currentPoint.y + nextPoint.y) / 2;

    path += ` Q ${currentPoint.x} ${currentPoint.y} ${midX} ${midY}`;
  }

  const lastPoint = visiblePoints[visiblePoints.length - 1];

  return `${path} L ${lastPoint.x} ${lastPoint.y}`;
}

export default function CursorLayer({ cursors }) {
  return (
    <div className="cursor-layer">
      {Object.entries(cursors).map(([userId, user]) => {
        if (!user.pointer) return null;

        const isActiveLaser =
          user.pointer.tool === "laser" && user.button === "down";
        const laserPoints = isActiveLaser
          ? [...(user.trail || []), user.pointer].filter(Boolean)
          : [];
        const laserPath = getLaserPath(laserPoints);

        return (
          <div key={userId}>
            {isActiveLaser && laserPath && (
              <svg
                className="remote-laser-beam"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  className="remote-laser-beam-core"
                  d={laserPath}
                  style={{
                    "--cursor-color": user.color || "#2563eb",
                  }}
                />
              </svg>
            )}

            <div
              className={`remote-cursor ${isActiveLaser ? "is-laser" : ""}`}
              style={{
                transform: `translate(${user.pointer.x}px, ${user.pointer.y}px)`,
                "--cursor-color": user.color || "#2563eb",
              }}
            >
              {isActiveLaser ? (
                <div className="remote-laser-dot" />
              ) : (
                <div className="cursor-arrow" />
              )}

              <div className="cursor-name">
                {user.user_name || "User"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
