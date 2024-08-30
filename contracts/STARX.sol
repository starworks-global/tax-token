// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./TaxToken.sol";

contract STARX is TaxToken {
    constructor(
        address initialOwner_,
        TaxRecipient[] memory taxRecipients_
    )
        TaxToken(
            "STARX",
            "STARX",
            initialOwner_,
            1000000000 * 10 ** 18,
            taxRecipients_
        )
    {}
}
