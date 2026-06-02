import "./CursorLayer.css";

export default function CursorLayer({ cursors }) {
  return (
    <div className="cursor-layer">
      {Object.entries(cursors).map(([userId, user]) => (
        <div
          key={userId}
          className="remote-cursor"
          style={{
            transform: `translate(${user.pointer.x}px, ${user.pointer.y}px)`,
          }}
        >
          <div className="cursor-arrow" />
          <div className="cursor-name">
            {user.user_name || "User"}
          </div>
        </div>
      ))}
    </div>
  );
}