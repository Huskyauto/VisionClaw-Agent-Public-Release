from pathlib import Path
import unittest


REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"


class DependencyConstraintTests(unittest.TestCase):
    def test_ci_installs_the_test_client_dependencies_separately_from_runtime(self):
        test_requirements = REQUIREMENTS.with_name("requirements-test.txt")
        self.assertTrue(test_requirements.exists(), "CI needs explicit test-only dependencies")
        requirements = test_requirements.read_text().splitlines()
        self.assertIn("-r requirements.txt", requirements)
        self.assertTrue(any(line.startswith("httpx2==") for line in requirements))
        self.assertTrue(any(line.startswith("pytest==") for line in requirements))
        workflow = (REQUIREMENTS.parents[2] / ".github/workflows/security-checks.yml").read_text()
        self.assertIn("-r services/scrapling-worker/requirements-test.txt", workflow)

    def test_fastapi_starlette_pair_is_explicitly_pinned(self):
        requirements = REQUIREMENTS.read_text().splitlines()
        self.assertIn("fastapi==0.162.4", requirements)
        self.assertIn("starlette==1.10.0", requirements)

    def test_transitive_http_dependencies_have_safe_minimum_versions(self):
        requirements = REQUIREMENTS.read_text().splitlines()
        self.assertIn("h11>=0.16.0", requirements)
        self.assertIn("idna>=3.15", requirements)


if __name__ == "__main__":
    unittest.main()
