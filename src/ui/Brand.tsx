/** The game's logo mark next to the DIFF RACE wordmark (the menus' top bar). */
export function Brand() {
  return (
    <div className="brand">
      <img src="/brand/logo.svg" alt="" width={56} height={56} />
      <div>
        <h1>DIFF<span>RACE</span></h1>
        <p className="subtitle">Race. Ram. Get diffed.</p>
      </div>
    </div>
  );
}
