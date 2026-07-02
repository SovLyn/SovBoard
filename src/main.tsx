import ReactDOM from "react-dom/client";
import App from "./App";
import QuickSelectorApp from "./components/QuickSelectorApp";

// 根据 URL query 参数分流：?window=quick-selector → 独立窗口，否则 → 主窗口
const params = new URLSearchParams(window.location.search);
const isQuickSelector = params.get("window") === "quick-selector";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isQuickSelector ? <QuickSelectorApp /> : <App />,
);
