<script context=module>
let activatedOverlays = 0;
</script>

<script>
import { browser } from "$app/env";
import { fade } from "svelte/transition";
import Portal from "$lib/components/Portal.svelte";
import { onDestroy, onMount } from "svelte";

export let bg = "rgba(0,0,0,.8)";

onMount(() => {
    if (browser) {
        activatedOverlays += 1;
        document.querySelector('.body').ariaHidden = "true";
        document.querySelector('.body').classList.add('big-process-overlay');
    }
})

onDestroy(() => {
    if (browser) {
        activatedOverlays -= 1;
        if (activatedOverlays === 0) {
            document.querySelector('.body').ariaHidden = "false";
            document.querySelector('.body').classList.remove('big-process-overlay');

        }
        
    }
})

// FIXME: when an element pops up before the last one has dismounted,
// the focus trapping won't work.
// We'll need a better solution than this!
function captureKeydown(event) {
    // capture all events
    if (event.code === 'Tab' || event.code === 'Space') {
        document.activeElement.blur();
        event.preventDefault();
    }
}

let classes = 'fixed top-0 left-0 right-0 w-screen h-screen grid place-content-center text-lg z-[120]'

</script>

<svelte:window on:keydown={captureKeydown} />

<Portal>
    {#key bg}
        <div transition:fade={{duration: 200}} style:background="{bg}" class={classes} />
    {/key}
    <div  transition:fade={{ duration: 300 }} 
        class={classes}
        >
        <slot />
    </div>
</Portal>

<style lang="postcss">
:global(.body) {
    transition: transform 400ms;
    transform-origin: center;
}
:global(.big-process-overlay) {
    transform: scale(.95) translateY(2.5vh);
}
</style>
