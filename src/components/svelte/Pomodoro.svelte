<script lang="ts">
  let circleCount = 4;
  let initialTime = "25:00";
</script>

<div>
  <section id="focus-circles" class="flex justify-center gap-2 mb-4">
    {#each Array(circleCount) as _, index}
      <div class="focus-circle" data-index={index}></div>
    {/each}
  </section>
  <section id="mode-buttons"></section>
  <section id="timer-display" class="timer-display text-huge font-light my-8">
    {initialTime}
  </section>
  <section id="timer-controls"></section>
</div>

<style>
  /* focus-circles */
  .focus-circle {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--color-light);
    background: transparent;
    transition: background-color 0.3s ease;
  }

  .focus-circle.filled {
    background: var(--color-light);
  }

  @media (min-width: 768px) {
    .focus-circle {
      width: 20px;
      height: 20px;
    }
  }

  /* mode-buttons */

  /* timer-display */
  .timer-display {
    font-variant-numeric: tabular-nums;
    min-width: 300px;
    text-align: center;
  }

  /* timer-controls */
</style>
