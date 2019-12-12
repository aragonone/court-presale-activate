pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/IsContract.sol";
import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/standards/ApproveAndCall.sol";
import "@aragon/court/contracts/standards/ERC900.sol";
import "./lib/IPresale.sol";


contract CourtPresaleActivate is IsContract, ApproveAndCallFallBack {
    using SafeERC20 for ERC20;

    string private constant ERROR_TOKEN_NOT_CONTRACT = "CPA_TOKEN_NOT_CONTRACT";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "CPA_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_PRESALE_NOT_CONTRACT = "CPA_PRESALE_NOT_CONTRACT";
    string private constant ERROR_ZERO_AMOUNT = "CPA_ZERO_AMOUNT";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CPA_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_WRONG_TOKEN = "CPA_WRONG_TOKEN";

    bytes32 internal constant ACTIVATE_DATA = keccak256("activate(uint256)");

    ERC20 bondedToken;
    ERC900 registry;
    IPresale presale;

    constructor(ERC20 _bondedToken, ERC900 _registry, IPresale _presale) public {
        require(isContract(address(_bondedToken)), ERROR_TOKEN_NOT_CONTRACT);
        require(isContract(address(_registry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(isContract(address(_presale)), ERROR_PRESALE_NOT_CONTRACT);

        bondedToken = _bondedToken;
        registry = _registry;
        presale = _presale;
    }

    function receiveApproval(address _from, uint256 _amount, address _token, bytes calldata) external {
        require(_amount > 0, ERROR_ZERO_AMOUNT);
        require(_token == address(presale.contributionToken()), ERROR_WRONG_TOKEN);

        // move tokens to this contract
        require(ERC20(_token).safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        // approve to presale
        require(ERC20(_token).safeApprove(address(presale), _amount), ERROR_TOKEN_TRANSFER_FAILED);

        // buy in presale
        presale.contribute(address(this), _amount);
        uint256 bondedTokensObtained = presale.contributionToTokens(_amount);

        // activate in registry
        bondedToken.approve(address(registry), bondedTokensObtained);
        registry.stakeFor(_from, bondedTokensObtained, abi.encodePacked(ACTIVATE_DATA));
    }

}
