import { Link, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Empty } from "./components/States";
import { Advisor } from "./pages/Advisor";
import { Login, Saved } from "./pages/Account";
import { CarDetail } from "./pages/CarDetail";
import { Compare } from "./pages/Compare";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="cars" element={<Explore />} />
        <Route path="cars/:id" element={<CarDetail />} />
        <Route path="compare" element={<Compare />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="login" element={<Login />} />
        <Route path="saved" element={<Saved />} />
        <Route path="*" element={<Empty title="Page not found"><Link to="/">Back to the home page</Link></Empty>} />
      </Route>
    </Routes>
  );
}
