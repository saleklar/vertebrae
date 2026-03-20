export function setupDoubleClickListener() {
  window.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    const label = target.closest('label');
    if (!label) return;

    // Check if there is a range input nearby
    let rangeInput: HTMLInputElement | null = null;
    
    // First check htmlFor
    if (label.htmlFor) {
      const byId = document.getElementById(label.htmlFor);
      if (byId && byId.tagName === 'INPUT' && (byId as HTMLInputElement).type === 'range') {
        rangeInput = byId as HTMLInputElement;
      }
    }

    if (!rangeInput) {
      let nextEl = label.nextElementSibling;
      let count = 0;
      while (nextEl && count < 3) {
        if (nextEl.tagName === 'LABEL') break; // hit the next label
        if (nextEl.tagName === 'INPUT' && (nextEl as HTMLInputElement).type === 'range') {
          rangeInput = nextEl as HTMLInputElement;
          break;
        }
        if (nextEl.querySelector('input[type="range"]')) {
          rangeInput = nextEl.querySelector('input[type="range"]') as HTMLInputElement;
          break;
        }
        // sometimes it's wrapped in a div
        if (nextEl.tagName === 'DIV') {
          const inp = nextEl.querySelector('input[type="range"]');
          if (inp) {
            rangeInput = inp as HTMLInputElement;
            break;
          }
        }
        nextEl = nextEl.nextElementSibling;
        count++;
      }
    }

    if (!rangeInput) {
      // Check if it's inside the label
      rangeInput = label.querySelector('input[type="range"]') as HTMLInputElement;
    }

    if (!rangeInput) return;

    // We found a label and range input pairing!
    openNumberEditor(label, rangeInput);
  });

  function openNumberEditor(label: HTMLElement, rangeInput: HTMLInputElement) {
    if (document.querySelector('.temp-number-input')) return;

    const currentValue = rangeInput.value;
    const min = rangeInput.min;
    const max = rangeInput.max;
    const step = rangeInput.step;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'temp-number-input';
    input.value = currentValue;
    if (min) input.min = min;
    if (max) input.max = max;
    if (step) input.step = step;
    else input.step = 'any';
    
    input.style.position = 'absolute';
    const rect = label.getBoundingClientRect();
    input.style.left = `${rect.left}px`;
    input.style.top = `${rect.top}px`;
    input.style.width = `120px`; // Fixed width to ensure it's usable
    input.style.height = `${Math.max(24, rect.height)}px`;
    input.style.zIndex = '100000';
    input.style.fontSize = window.getComputedStyle(label).fontSize || '12px';
    input.style.padding = '0 4px';
    input.style.boxSizing = 'border-box';
    input.style.background = '#333';
    input.style.color = '#fff';
    input.style.border = '1px solid #777';
    input.style.borderRadius = '3px';
    
    document.body.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        // Update React generic input
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(rangeInput, val.toString());
          rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
          rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          rangeInput.value = val.toString();
          rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
          rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      cleanup();
    };

    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
      } else if (e.key === 'Escape') {
        cleanup();
      }
    });

    // Prevent double clicking the input from re-triggering
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }
}
