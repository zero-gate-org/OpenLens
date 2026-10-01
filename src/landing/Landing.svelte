<script>
  /**
   * The landing page.
   *
   * Nine sections, each with its own layout family, so the page reads as a set
   * of decisions rather than one decision repeated: a split hero, a hairline
   * band, a grouped list, an uneven tile grid, a specimen grid, an accordion, a
   * split closing band, and a footer of columns.
   *
   * Section order is the argument in order. What it is (hero), why you should
   * believe it (facts), what is in it (tools), proof the pixels work (filters),
   * the part that is actually fun (text), the objections (questions), and then
   * the ask.
   */
  import SiteHeader from "./components/SiteHeader.svelte";
  import Hero from "./components/Hero.svelte";
  import FactsBand from "./components/FactsBand.svelte";
  import ToolBoard from "./components/ToolBoard.svelte";
  import FilterGallery from "./components/FilterGallery.svelte";
  import TextSpecimens from "./components/TextSpecimens.svelte";
  import Faq from "./components/Faq.svelte";
  import SiteFooter from "./components/SiteFooter.svelte";
</script>

<a class="skip-link" href="#main">Skip to content</a>

<SiteHeader />

<main id="main">
  <Hero />
  <FactsBand />
  <ToolBoard />
  <FilterGallery />
  <TextSpecimens />
  <Faq />
</main>

<SiteFooter />

<style>
  /*
   * Smooth in-page jumps, but only where the browser is not being asked to
   * honour a reduced-motion preference.
   *
   * `scroll-padding-top` is what stops an anchor landing underneath the floating
   * tab. The tab's lower edge is 16px plus 56px, so 88px puts the section
   * heading just clear of it with a little air.
   */
  :global(html) {
    scroll-behavior: smooth;
    scroll-padding-top: 88px;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html) {
      scroll-behavior: auto;
    }
  }
</style>
