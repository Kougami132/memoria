import tomllib
import unittest
from pathlib import Path


class PackagingTestCase(unittest.TestCase):
    def test_all_memoria_packages_included_in_pyproject(self):
        repo_root = Path(__file__).resolve().parent.parent
        pyproject_path = repo_root / "pyproject.toml"
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)

        tool_st = data.get("tool", {}).get("setuptools", {})
        packaged = set(tool_st.get("packages", []))

        memoria_dir = repo_root / "memoria"
        actual_packages = {"memoria"}
        for p in memoria_dir.rglob("*"):
            if p.is_dir() and (p / "__init__.py").exists():
                pkg_name = f"memoria.{p.relative_to(memoria_dir).as_posix().replace('/', '.')}"
                actual_packages.add(pkg_name)

        # memoria.tasks must be included to avoid ModuleNotFoundError in Docker/wheel installs
        self.assertIn(
            "memoria.tasks",
            packaged,
            f"'memoria.tasks' is missing from pyproject.toml [tool.setuptools].packages: {packaged}",
        )

        # All packages with __init__.py under memoria should be included in packages list
        missing = actual_packages - packaged
        self.assertFalse(
            missing,
            f"Subpackages exist on disk but are missing from pyproject.toml [tool.setuptools].packages: {missing}",
        )


if __name__ == "__main__":
    unittest.main()
