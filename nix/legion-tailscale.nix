# Isolated, checksum-pinned build artifact. The platform's environment package
# remains unchanged; deployment packaging must stage these binaries explicitly.
{ pkgs ? import <nixpkgs> {} }:
pkgs.stdenvNoCC.mkDerivation {
  pname = "visionclaw-tailscale";
  version = "1.104.7";
  src = pkgs.fetchurl {
    url = "https://pkgs.tailscale.com/stable/tailscale_1.104.7_amd64.tgz";
    sha256 = "e56693ff74a64f2591b7e819c280635a100aae1ddfb0ef058fcd052b7cd8d16c";
  };
  installPhase = ''
    mkdir -p $out/bin
    cp tailscale tailscaled $out/bin/
  '';
  dontFixup = true;
}
