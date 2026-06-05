import WhiteboardPage from "./pages/WhiteboardPage";
import AuthPage from "./pages/AuthPage";

function App() {
  if (window.location.pathname.startsWith("/auth")) {
    return <AuthPage />;
  }

  return <WhiteboardPage />;
}

export default App;
