# M03 Part E — Smooth crossover experimental option

The standalone synthetic WDRC renderer accepts `crossoverMode: "smooth"`. Its existing `hard` mode remains the **default** for backwards compatibility and reproducibility. Smooth weights use a cosine blend across ±0.18 octave at geometric-midpoint frequency boundaries. Detector energy is allocated proportionally and reconstruction uses a weighted blend of the two adjacent gains. All final gain and digital limiter processing remains downstream.

Run `npm test`. The regression suite compares 1410/1420 Hz in both modes, checks zero-gain identity, uniform response, independent ears and extreme-input digital ceilings.

This is an **experimental offline spectral interpolation**, not a validated acoustic crossover, speech quality guarantee, calibrated gain or real-time hearing route. Further dense sweeps, harmonic distortion and temporal/artifact testing are required before considering it as a default or attempting live output.

## Part F evidence and decision

See [M03_DENSE_CROSSOVER_AB.md](./M03_DENSE_CROSSOVER_AB.md). Both modes were measured across **all** 5 crossovers for the six-band fixture and 7 crossovers for the eight-band fixture. Smooth decreased adjacent-frequency maximum gain jumps at every synthetic seam. Selected harmonic projection was approximately equal, but narrow two-tone sidebands at 1400/1430 Hz were not uniformly improved.

**Decision: retain default `hard`.** The `smooth` mode remains research opt-in; numerical spectral interpolation evidence does not authorize speaker/headphone output or establish listening quality, time-domain artifacts, physical output safety or low end-to-end latency.
