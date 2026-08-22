import { isValidStellarAddress } from "../stellar";

describe("isValidStellarAddress", () => {
    it("should return true for a valid Stellar public key with a correct checksum", () => {
        // Standard valid public key
        const validAddress = "GCKN22I7433B3PFFAM3A45C33SCSXHVEO2CUKXOO6S3J52OQOADMEPHZ";
        expect(isValidStellarAddress(validAddress)).toBe(true);
    });

    it("should reject a string that matches the Regex shape (G...56 chars) but has an invalid checksum", () => {
        // This string starts with 'G' and is 56 chars, so regex passes, but checksum FAILS
        const regexMatchButChecksumInvalid = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

        expect(isValidStellarAddress(regexMatchButChecksumInvalid)).toBe(false);
    });

    it("should return false for invalid formats or empty strings", () => {
        expect(isValidStellarAddress("")).toBe(false);
        expect(isValidStellarAddress("invalid_address")).toBe(false);
        expect(isValidStellarAddress("G12345")).toBe(false);
    });
});
