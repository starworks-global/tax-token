import { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { TaxToken } from "../typechain-types";

const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_BUY_TAX_BASE = 250;
const INITIAL_SELL_TAX_BASE = 4500;

describe("TaxedToken", function () {
  async function createPermit(
    taxedToken: TaxToken,
    owner: Signer,
    spender: Signer,
    valueToSend: number
  ) {
    const domainSeparator = {
      name: "Taxed Token",
      version: "1",
      chainId: 31337,
      verifyingContract: await taxedToken.getAddress(),
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
    const value = {
      owner: await owner.getAddress(),
      spender: await spender.getAddress(),
      value: valueToSend,
      nonce: await taxedToken.nonces(owner.getAddress()),
      deadline,
    };

    const signature = await owner.signTypedData(domainSeparator, types, value);
    const { r, s, v } = ethers.Signature.from(signature);
    return { deadline, v, r, s };
  }

  async function getTax(
    taxedToken: TaxToken,
    from: Signer,
    to: Signer,
    amount: number
  ) {
    const fromAddress = await from.getAddress();
    const toAddress = await to.getAddress();
    return taxedToken.getTax(fromAddress, toAddress, amount);
  }

  async function deployFixture() {
    const [
      owner,
      operator,
      taxRecipient1,
      taxRecipient2,
      exchangePool1,
      exchangePool2,
      user1,
      user2,
    ] = await ethers.getSigners();
    const supply = BigInt(TOTAL_SUPPLY) * BigInt(10 ** 18);
    const taxedToken = await ethers.deployContract("TaxToken", [
      "Taxed Token",
      "TT",
      owner.getAddress(),
      supply,
      [
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 7000,
        },
        {
          wallet: await taxRecipient2.getAddress(),
          name: "Tax Recipient 2",
          taxBase: 3000,
        },
      ],
    ]);
    await taxedToken.waitForDeployment();

    return {
      taxedToken,
      owner,
      user1,
      user2,
      operator,
      exchangePool1,
      exchangePool2,
      taxRecipient1,
      taxRecipient2,
    };
  }

  describe("General", function () {
    it("should mint", async function () {
      const { taxedToken } = await deployFixture();

      const ownerBalance = await taxedToken.balanceOf(await taxedToken.owner());
      expect(Number(ethers.formatEther(ownerBalance))).to.equal(TOTAL_SUPPLY);
    });

    it("should black list", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      const trx = await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      await expect(trx)
        .to.emit(taxedToken, "BlackListUpdated")
        .withArgs(await user1.getAddress(), true);
    });

    it("should unblack list", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      const trx = await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), false);
      await expect(trx)
        .to.emit(taxedToken, "BlackListUpdated")
        .withArgs(await user1.getAddress(), false);
    });

    it("should exempt tax", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      const trx = await taxedToken
        .connect(owner)
        .taxExempt(await user1.getAddress(), true);
      await expect(trx)
        .to.emit(taxedToken, "TaxExemptionUpdated")
        .withArgs(await user1.getAddress(), true);
    });

    it("should revert on double exempt tax", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      const trx = await taxedToken
        .connect(owner)
        .taxExempt(await user1.getAddress(), true);
      await expect(trx)
        .to.emit(taxedToken, "TaxExemptionUpdated")
        .withArgs(await user1.getAddress(), true);

      const secondTrx = taxedToken
        .connect(owner)
        .taxExempt(await user1.getAddress(), true);
      await expect(secondTrx).to.be.revertedWith(
        "account already in exempted list"
      );
    });

    it("should unexempt tax", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      await taxedToken.connect(owner).taxExempt(await user1.getAddress(), true);
      const trx = await taxedToken
        .connect(owner)
        .taxExempt(await user1.getAddress(), false);
      await expect(trx)
        .to.emit(taxedToken, "TaxExemptionUpdated")
        .withArgs(await user1.getAddress(), false);
    });

    it("should set buy tax base", async function () {
      const { taxedToken, owner } = await deployFixture();

      const trx = await taxedToken.connect(owner).setBuyTaxBase(1000);
      await expect(trx)
        .to.emit(taxedToken, "BuyTaxBaseUpdated")
        .withArgs(INITIAL_BUY_TAX_BASE, 1000);
    });

    it("should set sell tax base", async function () {
      const { taxedToken, owner } = await deployFixture();

      const trx = await taxedToken.connect(owner).setSellTaxBase(1000);
      await expect(trx)
        .to.emit(taxedToken, "SellTaxBaseUpdated")
        .withArgs(INITIAL_SELL_TAX_BASE, 1000);
    });

    it("should add exchange pool", async function () {
      const { taxedToken, owner, exchangePool1 } = await deployFixture();

      const trx = await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await expect(trx)
        .to.emit(taxedToken, "ExchangePoolAdded")
        .withArgs(await exchangePool1.getAddress());
    });

    it("should remove exchange pool", async function () {
      const { taxedToken, owner, exchangePool1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      const trx = await taxedToken
        .connect(owner)
        .removeExchangePool(await exchangePool1.getAddress());
      await expect(trx)
        .to.emit(taxedToken, "ExchangePoolRemoved")
        .withArgs(await exchangePool1.getAddress());
    });

    it("should set tax recipient", async function () {
      const { taxedToken, owner, taxRecipient1 } = await deployFixture();

      const trx = await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);

      await expect(trx)
        .to.emit(taxedToken, "TaxRecipientUpdated")
        .withArgs([
          [await taxRecipient1.getAddress(), "Tax Recipient 1", 10000],
        ]);
    });

    it("should revert when set tax recipient with same address", async function () {
      const { taxedToken, owner, taxRecipient1 } = await deployFixture();

      const trx = taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);

      await expect(trx).to.be.revertedWith("account already in exempted list");
    });

    it("should revert if tax recipient is zero address", async function () {
      const { taxedToken, owner, taxRecipient1 } = await deployFixture();

      const trx = taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: "0x0000000000000000000000000000000000000000",
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);

      await expect(trx).to.be.revertedWith(
        "tax recipient must not be the zero address"
      );
    });
  });

  describe("Get Tax", function () {
    it("should get buy tax", async function () {
      const { taxedToken, owner, user1, exchangePool1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      const buyTax = await taxedToken.getTax(
        await exchangePool1.getAddress(),
        await user1.getAddress(),
        10000
      );
      expect(buyTax).to.equal(250);
    });

    it("should get sell tax", async function () {
      const { taxedToken, owner, user1, exchangePool1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      const sellTax = await taxedToken.getTax(
        await user1.getAddress(),
        await exchangePool1.getAddress(),
        10000
      );
      expect(sellTax).to.equal(4500);
    });

    it("should get 0 tax on exempted address", async function () {
      const { taxedToken, owner, user1, exchangePool1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).taxExempt(await user1.getAddress(), true);
      const tax = await taxedToken.getTax(
        await user1.getAddress(),
        await exchangePool1.getAddress(),
        10000
      );
      expect(tax).to.equal(0);
    });

    it("should get 0 tax on user to user transaction", async function () {
      const { taxedToken, user1, user2 } = await deployFixture();

      const tax = await taxedToken.getTax(
        await user1.getAddress(),
        await user2.getAddress(),
        10000
      );
      expect(tax).to.equal(0);
    });

    it("should get 0 tax on pool to pool transaction", async function () {
      const { taxedToken, exchangePool1, exchangePool2 } =
        await deployFixture();

      const tax = await taxedToken.getTax(
        await exchangePool1.getAddress(),
        await exchangePool2.getAddress(),
        10000
      );
      expect(tax).to.equal(0);
    });

    it("should get 0 tax on transfer to contract owner", async function () {
      const { taxedToken, owner, user1 } = await deployFixture();

      const tax = await taxedToken.getTax(
        await user1.getAddress(),
        await owner.getAddress(),
        10000
      );
      expect(tax).to.equal(0);
    });

    it("should not get tax - blacklisted", async function () {
      const { taxedToken, owner, user1, user2 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      const tax = taxedToken.getTax(
        await user1.getAddress(),
        await user2.getAddress(),
        10000
      );
      await expect(tax).to.be.revertedWith("BEP20: Blacklisted");
    });
  });

  describe("Permit", function () {
    it("should permit", async function () {
      const { taxedToken, owner, user1, operator } = await deployFixture();

      const domainSeparator = {
        name: "Taxed Token",
        version: "1",
        chainId: 31337,
        verifyingContract: await taxedToken.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
      const value = {
        owner: await owner.getAddress(),
        spender: await user1.getAddress(),
        value: 100,
        nonce: await taxedToken.nonces(owner.getAddress()),
        deadline,
      };

      const signature = await owner.signTypedData(
        domainSeparator,
        types,
        value
      );
      const initialAllowance = await taxedToken.allowance(
        await owner.getAddress(),
        await user1.getAddress()
      );
      const { r, s, v } = ethers.Signature.from(signature);
      expect(initialAllowance).to.equal(0);
      await taxedToken
        .connect(operator)
        .permit(
          await owner.getAddress(),
          await user1.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );
      const afterAllowance = await taxedToken.allowance(
        await owner.getAddress(),
        await user1.getAddress()
      );
      expect(afterAllowance).to.equal(100);
    });

    it("should not permit - wrong signer", async function () {
      const { taxedToken, owner, user1, operator, user2 } =
        await deployFixture();

      const domainSeparator = {
        name: "Taxed Token",
        version: "1",
        chainId: 31337,
        verifyingContract: await taxedToken.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
      const value = {
        owner: await owner.getAddress(),
        spender: await user1.getAddress(),
        value: 100,
        nonce: await taxedToken.nonces(owner.getAddress()),
        deadline,
      };

      const signature = await user2.signTypedData(
        domainSeparator,
        types,
        value
      );
      const { r, s, v } = ethers.Signature.from(signature);
      const trx = taxedToken
        .connect(operator)
        .permit(
          await owner.getAddress(),
          await user1.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );
      await expect(trx).to.be.revertedWith("ERC2612: Invalid Signer");
    });
  });

  describe("Non-Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { taxedToken, owner, user1, user2 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      const trx = taxedToken
        .connect(user1)
        .transfer(await user2.getAddress(), 10000);
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should transfer - user to user", async function () {
      const { taxedToken, owner, user1, user2 } = await deployFixture();
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      await taxedToken.connect(user1).transfer(await user2.getAddress(), 10000);
      const balance = await taxedToken.balanceOf(await user2.getAddress());
      expect(balance).to.equal(10000);
    });

    it("should transfer - tax exempt", async function () {
      const { taxedToken, owner, user1, exchangePool1 } = await deployFixture();
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).taxExempt(await user1.getAddress(), true);
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      await taxedToken
        .connect(user1)
        .transfer(await exchangePool1.getAddress(), 10000);
      const balance = await taxedToken.balanceOf(
        await exchangePool1.getAddress()
      );
      expect(balance).to.equal(10000);
    });
  });

  describe("Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { taxedToken, owner, user1, exchangePool1 } = await deployFixture();

      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      const trx = taxedToken
        .connect(user1)
        .transfer(await exchangePool1.getAddress(), 10000);
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should transfer - sell single tax recipient", async function () {
      const {
        taxedToken,
        owner,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
      } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());

      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      await taxedToken
        .connect(user1)
        .transfer(await exchangePool1.getAddress(), 10000);
      const exchangeBalance = await taxedToken.balanceOf(
        await exchangePool1.getAddress()
      );
      const taxBalance = await taxedToken.balanceOf(
        await taxRecipient1.getAddress()
      );

      const totalTax = await getTax(taxedToken, user1, exchangePool1, 10000);
      expect(exchangeBalance).to.equal(10000n - totalTax);
      expect(taxBalance).to.equal(totalTax);
    });

    it("should transfer - sell multiple tax recipients", async function () {
      const {
        taxedToken,
        owner,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
      } = await deployFixture();
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: await taxRecipient2.getAddress(),
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);
      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);

      await taxedToken
        .connect(user1)
        .transfer(await exchangePool1.getAddress(), 10000);
      const exchangeBalance = await taxedToken.balanceOf(
        await exchangePool1.getAddress()
      );
      const taxBalance1 = await taxedToken.balanceOf(
        await taxRecipient1.getAddress()
      );
      const taxBalance2 = await taxedToken.balanceOf(
        await taxRecipient2.getAddress()
      );

      const totalTax = await getTax(taxedToken, user1, exchangePool1, 10000);
      expect(exchangeBalance).to.equal(10000n - totalTax);
      expect(taxBalance1).to.equal(totalTax / 2n);
      expect(taxBalance2).to.equal(totalTax / 2n);
    });

    it("should transfer - buy single tax recipients", async function () {
      const {
        taxedToken,
        owner,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
      } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      await taxedToken
        .connect(owner)
        .transfer(await exchangePool1.getAddress(), 10000);

      await taxedToken
        .connect(exchangePool1)
        .transfer(await user1.getAddress(), 10000);
      const user1Balance = await taxedToken.balanceOf(await user1.getAddress());
      const taxBalance = await taxedToken.balanceOf(
        await taxRecipient1.getAddress()
      );

      const totalTax = await getTax(taxedToken, exchangePool1, user1, 10000);
      expect(user1Balance).to.equal(10000n - totalTax);
      expect(taxBalance).to.equal(totalTax);
    });

    it("should transfer - buy multiple tax recipient", async function () {
      const {
        taxedToken,
        owner,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
      } = await deployFixture();

      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: await taxRecipient2.getAddress(),
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);
      await taxedToken
        .connect(owner)
        .transfer(await exchangePool1.getAddress(), 10000);

      await taxedToken
        .connect(exchangePool1)
        .transfer(await user1.getAddress(), 10000);
      const user1Balance = await taxedToken.balanceOf(await user1.getAddress());
      const taxRecipient1Balance = await taxedToken.balanceOf(
        await taxRecipient1.getAddress()
      );
      const taxRecipient2Balance = await taxedToken.balanceOf(
        await taxRecipient2.getAddress()
      );

      const totalTax = await getTax(taxedToken, exchangePool1, user1, 10000);
      expect(user1Balance).to.equal(10000n - totalTax);
      expect(taxRecipient1Balance).to.equal(totalTax / 2n);
      expect(taxRecipient2Balance).to.equal(totalTax / 2n);
    });
  });

  describe("Permitted Non-Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { taxedToken, owner, user1, operator, user2 } =
        await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 100);
      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        user2,
        100
      );
      await taxedToken
        .connect(operator)
        .permit(
          await user1.getAddress(),
          await user2.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );

      const trx = taxedToken
        .connect(operator)
        .transferFrom(await user1.getAddress(), await user2.getAddress(), 100);
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should not transfer - insufficient allowance", async function () {
      const { taxedToken, owner, user1, operator, user2 } =
        await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 200);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        user2,
        100
      );
      await taxedToken
        .connect(operator)
        .permit(
          await user1.getAddress(),
          await user2.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );

      const trx = taxedToken
        .connect(operator)
        .transferFrom(await user1.getAddress(), await user2.getAddress(), 200);
      await expect(trx).to.be.revertedWith(
        "BEP20: Transfer amount exceeds allowance."
      );
    });

    it("should transfer", async function () {
      const { taxedToken, owner, user1, operator, user2, taxRecipient1 } =
        await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        operator,
        10000
      );
      await taxedToken
        .connect(operator)
        .permit(await user1.getAddress(), operator, 10000, deadline, v, r, s);

      await taxedToken
        .connect(operator)
        .transferFrom(
          await user1.getAddress(),
          await user2.getAddress(),
          10000
        );
      const balance = await taxedToken.balanceOf(await user2.getAddress());
      expect(balance).to.equal(10000);
    });

    it("should transfer - tax exempt", async function () {
      const {
        taxedToken,
        owner,
        user1,
        operator,
        exchangePool1,
        taxRecipient1,
      } = await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      await taxedToken.connect(owner).taxExempt(await user1.getAddress(), true);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        operator,
        10000
      );
      await taxedToken
        .connect(operator)
        .permit(await user1.getAddress(), operator, 10000, deadline, v, r, s);

      await taxedToken
        .connect(operator)
        .transferFrom(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          10000
        );
      const balance = await taxedToken.balanceOf(
        await exchangePool1.getAddress()
      );
      expect(balance).to.equal(10000);
    });
  });

  describe("Permitted Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { taxedToken, owner, user1, operator, exchangePool1 } =
        await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 100);
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken
        .connect(owner)
        .setBlacklistStatus(await user1.getAddress(), true);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        exchangePool1,
        100
      );
      await taxedToken
        .connect(operator)
        .permit(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );

      const trx = taxedToken
        .connect(operator)
        .transferFrom(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          100
        );
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should not transfer - insufficient allowance", async function () {
      const { taxedToken, owner, user1, operator, exchangePool1 } =
        await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 200);
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        exchangePool1,
        100
      );
      await taxedToken
        .connect(operator)
        .permit(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          100,
          deadline,
          v,
          r,
          s
        );

      const trx = taxedToken
        .connect(operator)
        .transferFrom(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          200
        );
      await expect(trx).to.be.revertedWith(
        "BEP20: Transfer amount exceeds allowance."
      );
    });

    it("should transfer - sell", async function () {
      const {
        taxedToken,
        owner,
        user1,
        operator,
        exchangePool1,
        taxRecipient1,
      } = await deployFixture();

      await taxedToken.connect(owner).transfer(await user1.getAddress(), 10000);
      await taxedToken
        .connect(owner)
        .addExchangePool(await exchangePool1.getAddress());
      await taxedToken.connect(owner).setTaxRecipient([
        {
          wallet: await taxRecipient1.getAddress(),
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);
      const { deadline, v, r, s } = await createPermit(
        taxedToken,
        user1,
        operator,
        10000
      );
      await taxedToken
        .connect(operator)
        .permit(await user1.getAddress(), operator, 10000, deadline, v, r, s);

      await taxedToken
        .connect(operator)
        .transferFrom(
          await user1.getAddress(),
          await exchangePool1.getAddress(),
          10000
        );
      const exchangeBalance = await taxedToken.balanceOf(
        await exchangePool1.getAddress()
      );
      const taxRecipientBalance = await taxedToken.balanceOf(
        await taxRecipient1.getAddress()
      );
      const totalTax = await getTax(taxedToken, user1, exchangePool1, 10000);
      expect(exchangeBalance).to.equal(10000n - totalTax);
      expect(taxRecipientBalance).to.equal(totalTax);
    });
  });
});
