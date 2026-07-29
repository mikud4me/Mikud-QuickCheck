export default function StagingBanner() {
  const isStaging = import.meta.env.VITE_STAGING_MODE === 'true';
  if (!isStaging) return null;

  return (
    <div
      style={{ zIndex: 99999 }}
      className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center font-bold py-2 px-4 text-sm shadow-lg"
    >
      ⚠️ מגרש משחקים (Staging) — בטוח לפיתוח ולשינויים — לא למצגות בנקים!
    </div>
  );
}