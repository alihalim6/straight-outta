import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { exchangeCodeForToken, saveAccessToken } from "../lib/spotifyAuth";

export default function Callback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const err = searchParams.get("error");
    if (err) {
      setError(`Spotify returned: ${err}`);
      return;
    }
    if (!code) {
      setError("No authorization code in URL.");
      return;
    }
    exchangeCodeForToken(code)
      .then((data) => {
        saveAccessToken(data.access_token);
        navigate("/refresh", { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "#c00" }}>{error}</p>
        <a href="/refresh">Back to Refresh</a>
      </div>
    );
  }
  return <div style={{ padding: "2rem" }}>Completing login…</div>;
}
