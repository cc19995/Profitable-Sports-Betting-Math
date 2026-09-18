export default function MathPage() {
  return (
    <article className="max-w-3xl space-y-5 text-sm leading-7">
      <h1 className="text-2xl font-semibold">The model implements this repository&apos;s math</h1>
      <p>
        Handicapping here is not picking winners. It is assigning a probability P and refusing to
        bet unless P is greater than the sportsbook implied probability S. Average gain per unit
        stake is B(P/S − 1). That quantity is positive if and only if P &gt; S.
      </p>
      <p>
        S includes juice. A −110 / −110 market is not a fair coin; each side is about 52.38%.
        De-vigged S′ is shown on the matchup sheet so you can see the tax. The betting hurdle is
        still S, not S′.
      </p>
      <p>
        Stake size scales with edge. Full Kelly is (P − S) / (1 − S). The desk recommends
        quarter-Kelly because full Kelly underweights the cost of ruin. Dynamic staking only
        helps if P is calibrated. Martingale does not.
      </p>
      <p>
        Parlays: if every leg has E &gt; J, the product P/S increases with each added leg and long-run
        ROI compounds. If any leg has no edge, juice compounds against you. Hit rate still falls
        as legs are added; variance rises; N must get larger.
      </p>
      <p>
        The football engine turns opponent-adjusted offensive and defensive ratings into an
        expected score, then a Gaussian (key-number-aware) distribution for win, cover, and total
        probabilities. Those probabilities are P. ESPN / nflverse closing-style prices are S.
      </p>
      <p className="mute">
        The original write-up and figures remain in the repository README and image files. This
        page is the operational translation of that write-up.
      </p>
    </article>
  );
}
