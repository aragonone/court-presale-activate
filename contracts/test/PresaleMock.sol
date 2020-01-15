pragma solidity ^0.5.8;

import "@aragon/court/contracts/lib/os/ERC20.sol";
import "@aragon/court/contracts/lib/os/SafeERC20.sol";
import "@aragon/court/contracts/lib/os/SafeMath.sol";
import "./ERC20Mock.sol";
import "../lib/IPresale.sol";


contract PresaleMock is IPresale {
    using SafeERC20  for ERC20;
    using SafeMath   for uint256;

    string private constant ERROR_TOKEN_TRANSFER_REVERTED  = "PRESALE_TOKEN_TRANSFER_REVERTED";

    uint256 public constant PPM = 1000000; // 0% = 0 * 10 ** 4; 1% = 1 * 10 ** 4; 100% = 100 * 10 ** 4

    ERC20 internal collateralToken;
    ERC20Mock public bondedToken;
    uint256 public exchangeRate;
    uint256 public totalRaised;

    event Contribute (address indexed contributor, uint256 value, uint256 amount);

    constructor(ERC20 _collateralToken, ERC20Mock _bondedToken, uint256 _exchangeRate) public {
        collateralToken = _collateralToken;
        bondedToken = _bondedToken;
        exchangeRate = _exchangeRate;
    }

    function open() external {
    }

    function close() external {
    }

    function contribute(address _contributor, uint256 _value) external payable {
        // (contributor) ~~~> contribution tokens ~~~> (presale)
        _transfer(collateralToken, _contributor, address(this), _value);

        // (mint ✨) ~~~> project tokens ~~~> (contributor)
        uint256 tokensToSell = contributionToTokens(_value);
        bondedToken.mint(_contributor, tokensToSell);
        totalRaised = totalRaised.add(_value);

        emit Contribute(_contributor, _value, tokensToSell);
    }

    function refund(address, uint256) external {
    }

    function contributionToTokens(uint256 _value) public view returns (uint256) {
        return _value.mul(exchangeRate).div(PPM);
    }

    function contributionToken() external view returns (ERC20) {
        return collateralToken;
    }

    function setCollateralToken(ERC20 _collateralToken) external {
        collateralToken = _collateralToken;
    }

    function _transfer(ERC20 _token, address _from, address _to, uint256 _amount) internal {
        if (_from == address(this)) {
            require(_token.safeTransfer(_to, _amount), ERROR_TOKEN_TRANSFER_REVERTED);
        } else {
            require(_token.safeTransferFrom(_from, _to, _amount), ERROR_TOKEN_TRANSFER_REVERTED);
        }
    }
}
