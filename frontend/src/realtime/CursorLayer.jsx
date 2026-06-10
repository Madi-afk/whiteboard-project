import "./CursorLayer.css";

export default function CursorLayer({ cursors }) {
  return (
    <div className="cursor-layer">
      {Object.entries(cursors).map(([userId, user]) => {
        if (!user.pointer) return null;

        const isLaser = user.pointer.tool === "laser";

        return (
          <div key={userId}>
            {isLaser &&
              (user.trail || []).map((point, index, trail) => (
                <div
                  key={`${userId}-laser-${index}`}
                  className="remote-laser-trail"
                  style={{
                    opacity: ((index + 1) / trail.length) * 0.75,
                    transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`,
                    "--cursor-color": user.color || "#ef4444",
                  }}
                />
              ))}

            <div
              className={`remote-cursor ${isLaser ? "is-laser" : ""}`}
              style={{
                transform: `translate(${user.pointer.x}px, ${user.pointer.y}px)`,
                "--cursor-color": user.color || "#2563eb",
              }}
            >
              {isLaser ? (
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
