/** The app icon: a gauge with a cyan arc, drawn with plain boxes so ImageResponse can render it. */
export function AppIcon({ size }: { size: number }) {
  const ring = Math.round(size * 0.56);
  const stroke = Math.max(4, Math.round(size * 0.07));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#07090c",
      }}
    >
      <div
        style={{
          width: ring,
          height: ring,
          borderRadius: "50%",
          border: `${stroke}px solid #22d3ee`,
          borderBottomColor: "transparent",
          transform: "rotate(45deg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: stroke,
            height: ring * 0.42,
            background: "#e9eef3",
            borderRadius: stroke,
            transform: "rotate(-15deg) translateY(-20%)",
          }}
        />
      </div>
    </div>
  );
}
