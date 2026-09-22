import { useState } from "react";
import { createRoot } from "react-dom/client";
import { increment } from "./counter.mjs";
import "./style.css";

function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1 data-whybuddy-source="src/main.tsx" data-whybuddy-line="10">New Project</h1>
      <div className="counter">
        <output aria-label="Count">{count}</output>
        <button data-whybuddy-source="src/main.tsx" data-whybuddy-line="13" type="button" aria-label="Increment count" title="Increment count"
          onClick={() => setCount(increment)}>
          +
        </button>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");
createRoot(root).render(<App />);
